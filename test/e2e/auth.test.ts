import 'reflect-metadata';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AuthError, Provider } from '../../src/domain/auth';
import { GoogleIdentityProvider } from '../../src/infrastructure/authentication/google.provider';
import { FacebookIdentityProvider } from '../../src/infrastructure/authentication/facebook.provider';
import { configureApp } from '../../src/bootstrap';
let app: INestApplication,
  mongo: ChildProcess,
  directory: string,
  connection: Connection;
before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), 'deep-drill-mongo-test-'));
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('port');
    const port = address.port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    mongo = spawn(
      process.env.MONGOD_BINARY ?? 'mongod',
      [
        '--dbpath',
        directory,
        '--port',
        String(port),
        '--bind_ip',
        '127.0.0.1',
        '--nounixsocket',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              'Mongo test startup timeout; install mongod or set MONGOD_BINARY',
            ),
          ),
        20000,
      );
      mongo.once('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      mongo.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('Mongo test startup failed'));
      });
      mongo.stdout!.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('Waiting for connections')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    Object.assign(process.env, {
      NODE_ENV: 'test',
      MONGODB_URI: `mongodb://127.0.0.1:${port}/auth-test`,
      JWT_SECRET: randomBytes(48).toString('hex'),
      JWT_EXPIRES_IN: '1h',
      AUTH_GOOGLE_ENABLED: 'false',
      AUTH_FACEBOOK_ENABLED: 'false',
      AUTH_RATE_LIMIT: '1000',
      SWAGGER_ENABLED: 'true',
    });
    const { AppModule } = await import('../../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleIdentityProvider)
      .useValue({
        validateCredential: async (c: string) => {
          if (c === 'invalid') throw new AuthError('AUTH_INVALID_CREDENTIAL');
          if (c.startsWith('profile:')) {
            const version = c.slice('profile:'.length);
            return {
              provider: Provider.Google,
              providerUserId: 'stable-google-sub',
              email: `${version}@example.test`,
              emailVerified: true,
              displayName: `Pilot ${version}`,
              avatarUrl: `https://example.test/${version}.png`,
            };
          }
          return {
            provider: Provider.Google,
            providerUserId: c,
            email: c === 'missing-email' ? undefined : 'pilot@example.test',
            displayName: 'Google Pilot',
          };
        },
      })
      .overrideProvider(FacebookIdentityProvider)
      .useValue({
        validateCredential: async (c: string) => ({
          provider: Provider.Facebook,
          providerUserId: c,
          displayName: 'Facebook Pilot',
        }),
      })
      .compile();
    app = module.createNestApplication({ logger: false, bodyParser: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    connection = app.get(getConnectionToken());
  },
  { timeout: 30000 },
);
after(async () => {
  await app?.close();
  if (mongo && mongo.exitCode === null) {
    mongo.kill('SIGTERM');
    await once(mongo, 'exit');
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
const api = () => request(app.getHttpServer());
test('health, security headers and OpenAPI available', async () => {
  const r = await api().get('/api/v1/health').expect(200);
  assert.deepEqual(r.body, { status: 'ok', database: 'up' });
  assert.ok(r.headers['x-content-type-options']);
  await api().get('/api/docs-json').expect(200);
});
test('social validation, unknown fields, unsupported provider', async () => {
  assert.equal(
    (
      await api()
        .post('/api/v1/auth/sign-in')
        .send({ provider: 'google', credential: 'invalid' })
        .expect(401)
    ).body.code,
    'AUTH_INVALID_CREDENTIAL',
  );
  assert.equal(
    (
      await api()
        .post('/api/v1/auth/sign-in')
        .send({ provider: 'unknown', credential: 'x' })
        .expect(400)
    ).body.code,
    'AUTH_INVALID_PROVIDER',
  );
  await api()
    .post('/api/v1/auth/sign-in')
    .send({ provider: 'google', credential: 'x', email: 'forged@example.test' })
    .expect(400);
});
test('concurrent first logins create one user, bounded sessions and no credentials stored', async () => {
  const results = await Promise.all(
    Array.from({ length: 16 }, () =>
      api()
        .post('/api/v1/auth/sign-in')
        .send({ provider: 'google', credential: 'concurrent-sub' })
        .expect(200),
    ),
  );
  assert.equal(new Set(results.map((r) => r.body.user.id)).size, 1);
  const record = await connection
    .collection('users')
    .findOne({ _id: results[0]!.body.user.id });
  assert.ok(record);
  assert.equal(record.sessions.length, 10);
  assert.equal(
    await connection
      .collection('users')
      .countDocuments({ 'providers.providerUserId': 'concurrent-sub' }),
    1,
  );
  assert.equal(record.credential, undefined);
  assert.equal(record.accessToken, undefined);
  const payload = JSON.parse(
    Buffer.from(
      results[0]!.body.accessToken.split('.')[1],
      'base64url',
    ).toString(),
  );
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'sid', 'sub']);
  const collections = await connection.db!.listCollections().toArray();
  assert.deepEqual(
    collections.map((c) => c.name),
    ['users'],
  );
});
test('Facebook without email signs in and revoke is enforced', async () => {
  const login = await api()
    .post('/api/v1/auth/sign-in')
    .send({ provider: 'facebook', credential: 'facebook-sub' })
    .expect(200);
  assert.equal(login.body.user.email, null);
  const header = `Bearer ${login.body.accessToken}`;
  await api()
    .post('/api/v1/auth/sign-out')
    .set('Authorization', header)
    .expect(200, { success: true });
  assert.equal(
    (
      await api()
        .post('/api/v1/auth/sign-out')
        .set('Authorization', header)
        .expect(401)
    ).body.code,
    'AUTH_SESSION_REVOKED',
  );
  await api()
    .post('/api/v1/auth/sign-out')
    .set('Authorization', 'Bearer junk')
    .expect(401);
  await api().post('/api/v1/auth/sign-out').expect(401);
});
test('username registration, profile, real password hashing and subsequent login', async () => {
  const input = {
    username: 'Pilot_One',
    password: 'a test only passphrase',
    displayName: 'Pilot One',
    gender: 'female',
  };
  const signup = await api()
    .post('/api/v1/auth/sign-up')
    .send(input)
    .expect(200);
  assert.equal(signup.body.user.username, 'pilot_one');
  assert.equal(signup.body.user.gender, 'female');
  assert.ok(!JSON.stringify(signup.body).includes('password'));
  const record = await connection
    .collection('users')
    .findOne({ _id: signup.body.user.id });
  assert.ok(record?.passwordHash.startsWith('$argon2id$'));
  assert.notEqual(record?.passwordHash, input.password);
  const signin = await api()
    .post('/api/v1/auth/sign-in/password')
    .send({ username: 'PILOT_ONE', password: input.password })
    .expect(200);
  assert.equal(signin.body.user.id, signup.body.user.id);
  await api().post('/api/v1/auth/sign-up').send(input).expect(409);
  const wrong = await api()
    .post('/api/v1/auth/sign-in/password')
    .send({ username: 'pilot_one', password: 'wrong passphrase' })
    .expect(401);
  const absent = await api()
    .post('/api/v1/auth/sign-in/password')
    .send({ username: 'unknown', password: input.password })
    .expect(401);
  assert.deepEqual(wrong.body, absent.body);
  await api()
    .post('/api/v1/auth/sign-up')
    .send({ ...input, username: 'bad!', gender: 'other' })
    .expect(400);
});

test('returning provider without email preserves prior email; sessions expire on server', async () => {
  const first = await api()
    .post('/api/v1/auth/sign-in')
    .send({ provider: 'google', credential: 'missing-email' })
    .expect(200);
  await connection.collection('users').updateOne(
    { _id: first.body.user.id },
    {
      $set: {
        email: 'previous@example.test',
        'sessions.0.expiresAt': new Date(0),
      },
    },
  );
  await api()
    .post('/api/v1/auth/sign-out')
    .set('Authorization', `Bearer ${first.body.accessToken}`)
    .expect(401);
  const again = await api()
    .post('/api/v1/auth/sign-in')
    .send({ provider: 'google', credential: 'missing-email' })
    .expect(200);
  assert.equal(again.body.user.id, first.body.user.id);
  assert.equal(again.body.user.email, 'previous@example.test');
  const record = await connection
    .collection('users')
    .findOne({ _id: first.body.user.id });
  assert.equal(record!.sessions.length, 1);
});
test('concurrent local registration creates only one account', async () => {
  const attempts = await Promise.all(
    Array.from({ length: 4 }, () =>
      api().post('/api/v1/auth/sign-up').send({
        username: 'concurrent_local',
        password: 'only a test passphrase',
        displayName: 'Test Pilot',
      }),
    ),
  );
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 409, 409, 409]);
  assert.equal(
    await connection
      .collection('users')
      .countDocuments({ username: 'concurrent_local' }),
    1,
  );
});

test('Google email/profile changes keep sub identity and add a distinct session', async () => {
  const first = await api()
    .post('/api/v1/auth/sign-in')
    .send({ provider: 'google', credential: 'profile:before' })
    .expect(200);
  const second = await api()
    .post('/api/v1/auth/sign-in')
    .send({ provider: 'google', credential: 'profile:after' })
    .expect(200);
  assert.equal(first.body.user.id, second.body.user.id);
  assert.equal(second.body.user.email, 'after@example.test');
  assert.equal(second.body.user.displayName, 'Pilot after');
  assert.equal(second.body.user.avatarUrl, 'https://example.test/after.png');
  const users = connection.collection('users');
  assert.equal(
    await users.countDocuments({
      providers: {
        $elemMatch: { type: 'google', providerUserId: 'stable-google-sub' },
      },
    }),
    1,
  );
  const record = await users.findOne({ _id: first.body.user.id });
  assert.equal(record!.sessions.length, 2);
  assert.notEqual(record!.sessions[0].id, record!.sessions[1].id);
  assert.ok(record!.lastLoginAt instanceof Date);
});

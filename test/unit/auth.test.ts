import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  AuthError,
  ExternalIdentity,
  LocalRegistration,
  Provider,
  Session,
  User,
  UserRepository,
} from '../../src/domain/auth';
import {
  RegisterUseCase,
  SessionIssuer,
  SignInUseCase,
  SignOutUseCase,
  ValidateSessionUseCase,
} from '../../src/application/auth.use-cases';
import {
  PasswordHasher,
  TokenClaims,
  TokenIssuer,
} from '../../src/application/ports';
import { JwtService } from '@nestjs/jwt';
import { JwtTokenIssuer } from '../../src/infrastructure/authentication/jwt-token.issuer';
import { validateEnvironment } from '../../src/infrastructure/config/environment';
class MemoryUsers implements UserRepository {
  users: User[] = [];
  async socialUser(identity: ExternalIdentity) {
    let user = this.users.find((u) =>
      u.providers.some(
        (p) =>
          p.type === identity.provider &&
          p.providerUserId === identity.providerUserId,
      ),
    );
    if (!user) {
      user = {
        id: randomUUID(),
        providers: [
          {
            type: identity.provider,
            providerUserId: identity.providerUserId,
            email: identity.email ?? null,
            emailVerified: false,
            linkedAt: new Date(),
          },
        ],
        displayName: 'Pilot',
        username: null,
        gender: 'unspecified',
        email: identity.email ?? null,
        avatarUrl: null,
        sessions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      };
      this.users.push(user);
    }
    return user;
  }
  async findLocal(username: string) {
    return this.users.find((u) => u.username === username) ?? null;
  }
  async createLocal(
    input: Omit<LocalRegistration, 'password'>,
    passwordHash: string,
  ) {
    if (await this.findLocal(input.username))
      throw new AuthError('AUTH_REGISTRATION_FAILED', 409);
    const user = await this.socialUser({
      provider: Provider.Google,
      providerUserId: randomUUID(),
    });
    Object.assign(user, {
      username: input.username,
      displayName: input.displayName,
      gender: input.gender ?? 'unspecified',
      passwordHash,
    });
    return user;
  }
  async appendSession(id: string, session: Session, limit: number) {
    const user = this.users.find((u) => u.id === id)!;
    user.sessions = [...user.sessions, session].slice(-limit);
  }
  async requireActiveSession(id: string, sid: string, now: Date) {
    const session = this.users
      .find((u) => u.id === id)
      ?.sessions.find((s) => s.id === sid);
    if (!session || session.expiresAt <= now)
      throw new AuthError('AUTH_INVALID_SESSION');
    if (session.revokedAt) throw new AuthError('AUTH_SESSION_REVOKED');
  }
  async revokeSession(id: string, sid: string, now: Date) {
    await this.requireActiveSession(id, sid, now);
    this.users
      .find((u) => u.id === id)!
      .sessions.find((s) => s.id === sid)!.revokedAt = now;
  }
}
const passwords: PasswordHasher = {
  hash: async (p) => 'hash:' + p,
  verify: async (h, p) => h === 'hash:' + p,
};
function fixture() {
  const users = new MemoryUsers();
  const issued: TokenClaims[] = [];
  const tokens: TokenIssuer = {
    issue: (c) => {
      issued.push(c);
      return 'test-token';
    },
    verify: () => issued[issued.length - 1]!,
  };
  const sessions = new SessionIssuer(users, tokens, 3600, 10);
  const providers: Record<
    Provider.Google | Provider.Facebook,
    import('../../src/application/ports').IdentityProvider
  > = {
    google: {
      validateCredential: async (c: string) => {
        if (c === 'bad') throw new AuthError('AUTH_INVALID_CREDENTIAL');
        return {
          provider: Provider.Google,
          providerUserId: 'google-sub',
          email: 'same@example.test',
        };
      },
    },
    facebook: {
      validateCredential: async () => ({
        provider: Provider.Facebook,
        providerUserId: 'facebook-sub',
        email: 'same@example.test',
      }),
    },
  };
  return {
    users,
    issued,
    tokens,
    sessions,
    signIn: new SignInUseCase(users, providers, sessions, passwords),
  };
}
for (const provider of [Provider.Google, Provider.Facebook] as const)
  test(`valid ${provider} creates user and own session; repeat uses same user`, async () => {
    const f = fixture();
    const first = await f.signIn.social(provider, 'credential');
    const second = await f.signIn.social(provider, 'credential');
    assert.equal(first.user.id, second.user.id);
    assert.equal(f.users.users.length, 1);
    assert.equal(f.users.users[0]!.sessions.length, 2);
    assert.notEqual(f.issued[0]!.sid, f.issued[1]!.sid);
    assert.equal(first.accessToken, 'test-token');
    assert.ok(Date.parse(first.expiresAt) > Date.now());
    assert.deepEqual(Object.keys(first.user).sort(), [
      'avatarUrl',
      'displayName',
      'email',
      'gender',
      'id',
      'provider',
      'username',
    ]);
  });
test('invalid provider credential cannot create account or session', async () => {
  const f = fixture();
  await assert.rejects(f.signIn.social(Provider.Google, 'bad'), {
    code: 'AUTH_INVALID_CREDENTIAL',
  });
  assert.equal(f.users.users.length, 0);
});
test('equal emails from different providers never link accounts', async () => {
  const f = fixture();
  const g = await f.signIn.social(Provider.Google, 'ok'),
    b = await f.signIn.social(Provider.Facebook, 'ok');
  assert.notEqual(g.user.id, b.user.id);
});
test('valid sign out revokes; second sign out and guard reject revoked sessions', async () => {
  const f = fixture();
  await f.signIn.social(Provider.Google, 'ok');
  const out = new SignOutUseCase(f.users);
  assert.deepEqual(await out.execute(f.issued[0]!), { success: true });
  await assert.rejects(out.execute(f.issued[0]!), {
    code: 'AUTH_SESSION_REVOKED',
  });
  await assert.rejects(
    new ValidateSessionUseCase(f.users, f.tokens).execute('token'),
    { code: 'AUTH_SESSION_REVOKED' },
  );
});
test('sign out rejects unknown session', async () => {
  const f = fixture();
  await assert.rejects(
    new SignOutUseCase(f.users).execute({
      sub: randomUUID(),
      sid: randomUUID(),
    }),
    { code: 'AUTH_INVALID_SESSION' },
  );
});
test('local registration normalizes username; wrong password and missing account share error', async () => {
  const f = fixture();
  const register = new RegisterUseCase(f.users, passwords, f.sessions);
  const a = await register.execute({
    username: 'Test_Pilot',
    password: 'long passphrase',
    displayName: ' Pilot ',
    gender: 'non_binary',
  });
  assert.equal(a.user.username, 'test_pilot');
  assert.equal(a.user.gender, 'non_binary');
  assert.equal(a.user.displayName, 'Pilot');
  const login = await f.signIn.local('TEST_PILOT', 'long passphrase');
  assert.equal(login.user.id, a.user.id);
  for (const [u, p] of [
    ['test_pilot', 'wrong'],
    ['missing', 'long passphrase'],
  ])
    await assert.rejects(f.signIn.local(u!, p!), {
      code: 'AUTH_INVALID_CREDENTIAL',
    });
  assert.ok(!JSON.stringify(a).includes('hash:'));
});
test('JWT only contains minimal claims and rejects tampered or expired tokens', () => {
  const service = new JwtService({ secret: 'test-only-'.repeat(8) }),
    issuer = new JwtTokenIssuer(service),
    claims = { sub: randomUUID(), sid: randomUUID() };
  const token = issuer.issue(claims, new Date(Date.now() + 60000));
  assert.deepEqual(Object.keys(service.decode(token)).sort(), [
    'exp',
    'iat',
    'sid',
    'sub',
  ]);
  assert.deepEqual(issuer.verify(token), claims);
  assert.throws(() => issuer.verify(token + 'x'), {
    code: 'AUTH_INVALID_SESSION',
  });
  assert.throws(
    () => issuer.verify(issuer.issue(claims, new Date(Date.now() - 60000))),
    { code: 'AUTH_INVALID_SESSION' },
  );
});
test('configuration fails early for missing secrets and enabled unconfigured provider', () => {
  const base = {
    JWT_SECRET: 'test-only-'.repeat(8),
    MONGODB_URI: 'mongodb://localhost/test',
  };
  assert.throws(() => validateEnvironment({}), /JWT_SECRET/);
  assert.throws(
    () => validateEnvironment({ ...base, JWT_SECRET: 'short' }),
    /JWT_SECRET/,
  );
  assert.throws(
    () => validateEnvironment({ ...base, AUTH_GOOGLE_ENABLED: 'true' }),
    /GOOGLE_CLIENT_ID/,
  );
  assert.throws(
    () => validateEnvironment({ ...base, CORS_ORIGINS: '*' }),
    /CORS/,
  );
  assert.equal(validateEnvironment(base).MAX_SESSIONS, 10);
});

import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuthController } from '../../src/interfaces/http/auth.controller';
import { HealthController } from '../../src/interfaces/http/health.controller';
import { Connection } from 'mongoose';
test('Google success log contains only the game user ID after the session is created', async (t) => {
  const f = fixture();
  const logs: string[] = [];
  t.mock.method(Logger.prototype, 'log', (message: string) => {
    logs.push(message);
  });
  const controller = new AuthController(
    f.signIn,
    new RegisterUseCase(f.users, passwords, f.sessions),
    new SignOutUseCase(f.users),
  );
  const result = await controller.social({
    provider: Provider.Google,
    credential: 'unit-provider-credential',
  });
  assert.deepEqual(logs, [
    `Google authentication successful userId=${result.user.id}`,
  ]);
  await assert.rejects(
    controller.social({ provider: Provider.Google, credential: 'bad' }),
  );
  assert.equal(logs.length, 1);
});
test('health checks Mongo ping and sanitizes database failures', async () => {
  let fail = false;
  const mongo = {
    readyState: 1,
    db: {
      command: async () => {
        if (fail) throw new Error('private database detail');
        return { ok: 1 };
      },
    },
  };
  const controller = new HealthController(mongo as unknown as Connection);
  assert.deepEqual(await controller.health(), { status: 'ok', database: 'up' });
  fail = true;
  await assert.rejects(controller.health(), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.ok(!error.message.includes('private database detail'));
    return true;
  });
  mongo.readyState = 0;
  await assert.rejects(controller.health(), ServiceUnavailableException);
});

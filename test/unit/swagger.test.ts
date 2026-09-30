import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  RegisterUseCase,
  SignInUseCase,
  SignOutUseCase,
  ValidateSessionUseCase,
} from '../../src/application/auth.use-cases';
import { configureApp } from '../../src/bootstrap';
import { AuthController } from '../../src/interfaces/http/auth.controller';
import { HealthController } from '../../src/interfaces/http/health.controller';

async function createApp(enabled: boolean) {
  const module = await Test.createTestingModule({
    controllers: [AuthController, HealthController],
    providers: [
      {
        provide: ConfigService,
        useValue: new ConfigService({
          CORS_ORIGINS: [],
          SWAGGER_ENABLED: enabled,
        }),
      },
      ...[
        RegisterUseCase,
        SignInUseCase,
        SignOutUseCase,
        ValidateSessionUseCase,
      ].map((provide) => ({ provide, useValue: {} })),
      {
        provide: getConnectionToken(),
        useValue: { readyState: 1, db: { command: async () => ({ ok: 1 }) } },
      },
    ],
  }).compile();
  const app = module.createNestApplication({
    logger: false,
    bodyParser: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

test('OpenAPI documents all versioned routes, request schemas and session security', async (t) => {
  const app = await createApp(true);
  t.after(() => app.close());
  const api = request(app.getHttpServer());
  const response = await api.get('/api/docs-json').expect(200);
  const document: OpenAPIObject = response.body;
  assert.equal(document.info.title, 'Deep Drill API');
  assert.deepEqual(Object.keys(document.paths).sort(), [
    '/api/v1/auth/sign-in',
    '/api/v1/auth/sign-in/password',
    '/api/v1/auth/sign-out',
    '/api/v1/auth/sign-up',
    '/api/v1/health',
  ]);
  const security = document.components?.securitySchemes?.bearer;
  assert.ok(security && !('$ref' in security));
  assert.equal(security.type, 'http');
  assert.equal(security.scheme, 'bearer');
  assert.equal(security.bearerFormat, 'JWT');
  assert.deepEqual(document.paths['/api/v1/auth/sign-out']?.post?.security, [
    { bearer: [] },
  ]);
  assert.equal(
    document.paths['/api/v1/auth/sign-up']?.post?.security,
    undefined,
  );
  for (const path of Object.values(document.paths)) {
    const operation = path.get ?? path.post;
    assert.ok(operation?.summary);
    assert.ok(operation.responses['200']);
    assert.ok(operation.responses['429']);
  }
  const signup = document.paths['/api/v1/auth/sign-up']?.post;
  const body = signup?.requestBody;
  assert.ok(body && !('$ref' in body));
  assert.deepEqual(body.content['application/json']?.schema, {
    $ref: '#/components/schemas/SignUpDto',
  });
  assert.ok(signup?.responses['409']);
  const schema = document.components?.schemas?.SignUpDto;
  assert.ok(schema && !('$ref' in schema));
  assert.deepEqual([...(schema.required ?? [])].sort(), [
    'displayName',
    'password',
    'username',
  ]);
  const password = schema.properties?.password;
  assert.ok(password && !('$ref' in password));
  assert.equal(password.minLength, 12);
  assert.equal(password.writeOnly, true);
  const health = document.paths['/api/v1/health']?.get;
  const ok = health?.responses['200'];
  assert.ok(ok && !('$ref' in ok));
  assert.deepEqual(ok.content?.['application/json']?.schema, {
    $ref: '#/components/schemas/HealthResponseDto',
  });
  assert.ok(health?.responses['503']);
  await api.post('/api/v1/auth/sign-out').expect(401);
});

test('Swagger serves the UI, its local assets and the YAML schema', async (t) => {
  const app = await createApp(true);
  t.after(() => app.close());
  const api = request(app.getHttpServer());
  const ui = await api.get('/api/docs/').expect(200);
  assert.match(ui.text, /Deep Drill API · Swagger/);
  assert.match(ui.text, /swagger-ui-init.js/);
  assert.ok(ui.headers['content-security-policy']);
  const init = await api.get('/api/docs/swagger-ui-init.js').expect(200);
  assert.match(init.text, /"persistAuthorization": false/);
  assert.match(init.text, /"validatorUrl": null/);
  await api.get('/api/docs/swagger-ui-bundle.js').expect(200);
  await api.get('/api/docs/swagger-ui.css').expect(200);
  const yaml = await api.get('/api/docs-yaml').expect(200);
  assert.match(yaml.text, /\/api\/v1\/auth\/sign-up:/);
});

test('disabling Swagger hides documentation while preserving API routes', async (t) => {
  const app = await createApp(false);
  t.after(() => app.close());
  const api = request(app.getHttpServer());
  for (const path of [
    '/api/docs',
    '/api/docs/',
    '/api/docs-json',
    '/api/docs-yaml',
    '/api/docs/swagger-ui-init.js',
  ]) {
    await api.get(path).expect(404);
  }
  await api.get('/api/v1/health').expect(200, { status: 'ok', database: 'up' });
});

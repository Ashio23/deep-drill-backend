import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { AuthError } from '../../src/domain/auth';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { FacebookIdentityProvider } from '../../src/infrastructure/authentication/facebook.provider';
import { GoogleIdentityProvider } from '../../src/infrastructure/authentication/google.provider';
const config = new ConfigService({
  AUTH_FACEBOOK_ENABLED: true,
  FACEBOOK_APP_ID: '123',
  FACEBOOK_APP_SECRET: 'test-only',
  FACEBOOK_GRAPH_API_VERSION: 'v26.0',
});
const valid = {
  is_valid: true,
  app_id: '123',
  type: 'USER',
  user_id: '456',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  scopes: ['public_profile'],
};
test('Facebook validates debug token before reading identity; missing email is valid', async (t) => {
  const urls: URL[] = [];
  const headers: Headers[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL, init: RequestInit) => {
    urls.push(input);
    headers.push(new Headers(init.headers));
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    return Response.json(
      urls.length === 1 ? { data: valid } : { id: '456', name: 'Pilot' },
    );
  });
  const identity = await new FacebookIdentityProvider(
    config,
  ).validateCredential('test-credential');
  assert.equal(identity.providerUserId, '456');
  assert.equal(identity.email, undefined);
  assert.equal(urls[1]!.searchParams.get('fields'), 'id,name,picture');
  assert.equal(urls[0]!.pathname, '/v26.0/debug_token');
  assert.equal(urls[0]!.searchParams.get('input_token'), 'test-credential');
  assert.equal(headers[0]!.get('Authorization'), 'Bearer 123|test-only');
  assert.equal(urls[1]!.pathname, '/v26.0/me');
  assert.equal(headers[1]!.get('Authorization'), 'Bearer test-credential');
  assert.equal(
    urls[1]!.searchParams.get('appsecret_proof'),
    createHmac('sha256', 'test-only').update('test-credential').digest('hex'),
  );
  assert.ok(urls.every((url) => !url.toString().includes('test-only')));
});
for (const [name, patch] of Object.entries({
  invalid: { is_valid: false },
  stringValidity: { is_valid: 'true' },
  stringExpiration: { expires_at: 'not-a-date' },
  missingExpiration: { expires_at: undefined },
  fractionalExpiration: { expires_at: 123.5 },
  malformedDataExpiration: { data_access_expires_at: 'never' },
  negativeDataExpiration: { data_access_expires_at: -1 },
  malformedScopes: { scopes: 'public_profile' },
  malformedUser: { user_id: 456 },
  wrongApp: { app_id: 'other' },
  expired: { expires_at: 1 },
  dataExpired: { data_access_expires_at: 1 },
  noScope: { scopes: [] },
  missingUser: { user_id: undefined },
  wrongType: { type: 'PAGE' },
}))
  test(`Facebook rejects ${name}`, async (t) => {
    let count = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      count++;
      return Response.json({ data: { ...valid, ...patch } });
    });
    await assert.rejects(
      new FacebookIdentityProvider(config).validateCredential(
        'test-credential',
      ),
      (error: unknown) => error instanceof AuthError && error.status === 401,
    );
    assert.equal(count, 1);
  });
test('Facebook rejects mismatched me identity', async (t) => {
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(++n === 1 ? { data: valid } : { id: 'attacker' }),
  );
  await assert.rejects(
    new FacebookIdentityProvider(config).validateCredential('test'),
    { code: 'AUTH_INVALID_CREDENTIAL' },
  );
});
test('disabled providers never contact provider network', async () => {
  const empty = new ConfigService({});
  await assert.rejects(
    new GoogleIdentityProvider(empty).validateCredential('test'),
    { code: 'AUTH_PROVIDER_UNAVAILABLE' },
  );
  await assert.rejects(
    new FacebookIdentityProvider(empty).validateCredential('test'),
    { code: 'AUTH_PROVIDER_UNAVAILABLE' },
  );
});

// Exercise Google's real JWT verification with locally generated test signing keys.
// Only the official certificate download is mocked; no network or real provider secret.
import { OAuth2Client } from 'google-auth-library';
import { generateKeyPairSync, sign } from 'node:crypto';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keys.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
function googleToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'test-key' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'verified-google-id',
      aud: 'test.apps.googleusercontent.com',
      iss: 'https://accounts.google.com',
      iat: now,
      exp: now + 3600,
      email: 'pilot@example.test',
      email_verified: true,
      name: 'Google Pilot',
      picture: 'https://example.test/avatar.png',
      ...overrides,
    }),
  ).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), keys.privateKey).toString('base64url')}`;
}
const googleConfig = new ConfigService({
  AUTH_GOOGLE_ENABLED: true,
  GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
});
test('Google verifies a signed identity using the official verifier', async (t) => {
  t.mock.method(
    OAuth2Client.prototype,
    'getFederatedSignonCertsAsync',
    async () => ({
      certs: { 'test-key': publicKey },
      format: 'PEM',
    }),
  );
  const identity = await new GoogleIdentityProvider(
    googleConfig,
  ).validateCredential(googleToken());
  assert.equal(identity.providerUserId, 'verified-google-id');
  assert.equal(identity.emailVerified, true);
  assert.equal(identity.email, 'pilot@example.test');
  assert.equal(identity.displayName, 'Google Pilot');
  assert.equal(identity.avatarUrl, 'https://example.test/avatar.png');
});
for (const [label, claims] of Object.entries({
  audience: { aud: 'other.apps.googleusercontent.com' },
  issuer: { iss: 'https://attacker.test' },
  expiration: { exp: Math.floor(Date.now() / 1000) - 1000 },
}))
  test(`Google rejects wrong ${label}`, async (t) => {
    t.mock.method(
      OAuth2Client.prototype,
      'getFederatedSignonCertsAsync',
      async () => ({
        certs: { 'test-key': publicKey },
        format: 'PEM',
      }),
    );
    await assert.rejects(
      new GoogleIdentityProvider(googleConfig).validateCredential(
        googleToken(claims),
      ),
      { code: 'AUTH_INVALID_CREDENTIAL' },
    );
  });
test('Google rejects an altered signature', async (t) => {
  t.mock.method(
    OAuth2Client.prototype,
    'getFederatedSignonCertsAsync',
    async () => ({
      certs: { 'test-key': publicKey },
      format: 'PEM',
    }),
  );
  const token = googleToken();
  const pieces = token.split('.');
  pieces[2] = 'AAAA' + pieces[2]!.slice(4);
  await assert.rejects(
    new GoogleIdentityProvider(googleConfig).validateCredential(
      pieces.join('.'),
    ),
    { code: 'AUTH_INVALID_CREDENTIAL' },
  );
});

test('Google adapter never exposes verification errors containing credentials', async (t) => {
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => {
    throw new Error(
      'Wrong recipient, payload audience != requiredAudience; private-credential-marker',
    );
  });
  await assert.rejects(
    new GoogleIdentityProvider(googleConfig).validateCredential(
      'private-credential-marker',
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as { code?: string }).code,
        'AUTH_INVALID_CREDENTIAL',
      );
      assert.ok(!error.message.includes('private-credential-marker'));
      assert.ok(!error.message.includes('audience'));
      return true;
    },
  );
});

for (const dataAccess of [undefined, 0, Math.floor(Date.now() / 1000) + 3600])
  test(`Facebook accepts optional email and data expiration ${dataAccess === undefined ? 'absent' : dataAccess === 0 ? 'zero' : 'future'}`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: URL) => {
      calls++;
      if (calls === 1)
        return Response.json({
          data: {
            ...valid,
            scopes: ['public_profile', 'email'],
            data_access_expires_at: dataAccess,
          },
        });
      assert.equal(url.searchParams.get('fields'), 'id,name,picture,email');
      return Response.json({ id: '456', name: 'Pilot', email: null });
    });
    const identity = await new FacebookIdentityProvider(
      config,
    ).validateCredential('test');
    assert.equal(identity.email, undefined);
    assert.equal(identity.provider, 'facebook');
  });
for (const status of [429, 500, 503])
  test(`Facebook Graph ${status} is recoverable without exposing provider content`, async (t) => {
    t.mock.method(
      globalThis,
      'fetch',
      async () => new Response('private-provider-marker', { status }),
    );
    await assert.rejects(
      new FacebookIdentityProvider(config).validateCredential('private-token'),
      {
        code: 'SERVER_UNAVAILABLE',
        status: 503,
        message: 'SERVER_UNAVAILABLE',
      },
    );
  });
test('Facebook transport exception is sanitized and recoverable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('private-token-in-url');
  });
  await assert.rejects(
    new FacebookIdentityProvider(config).validateCredential('private-token'),
    { code: 'SERVER_UNAVAILABLE', status: 503, message: 'SERVER_UNAVAILABLE' },
  );
});
test('Facebook Graph credential rejection remains unauthorized', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('private-provider-marker', { status: 400 }),
  );
  await assert.rejects(
    new FacebookIdentityProvider(config).validateCredential('private-token'),
    { code: 'AUTH_INVALID_CREDENTIAL', status: 401 },
  );
});

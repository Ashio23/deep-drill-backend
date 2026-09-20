import { test } from 'node:test';
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
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    urls.push(input);
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
  assert.ok(urls[1]!.searchParams.get('appsecret_proof'));
});
for (const [name, patch] of Object.entries({
  invalid: { is_valid: false },
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

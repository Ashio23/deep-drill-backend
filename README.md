# Deep Drill Backend

Standalone modular NestJS authentication service. Client: `../Android`; backend: this directory. This backend is versioned independently at [Ashio23/deep-drill-backend](https://github.com/Ashio23/deep-drill-backend). Node 24 LTS, TypeScript strict, NestJS 12, Mongoose 9 / MongoDB 8. Exact dependencies are locked in `package-lock.json`.

## Run locally

```sh
nvm use
npm ci
test -f .env || cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# On a new setup, put the generated value in JWT_SECRET; preserve an existing secret.
# Set MONGODB_URI to your Mongo URI ending in /deep-drill (or mongodb://127.0.0.1:27017/deep-drill).
docker compose up -d
npm run start:dev
```

Mongo is exposed on host loopback only; Compose is for development, without authentication. Do not expose this Mongo service publicly. You can instead run an installed MongoDB 8 instance and configure MONGODB_URI. Android emulator connects to `http://10.0.2.2:3000/api/v1`; this is the complete API root.

```sh
npm run lint
npm test
npm run test:e2e
npm run build
npm run start:prod
```

E2E starts an isolated **real** MongoDB process on a free loopback port in a temporary directory and removes it afterward. Install `mongod` 8 and put it on PATH, or set `MONGOD_BINARY=/path/to/mongod`. No Google/Meta credentials or existing database are used. `npm test` uses in-memory ports and mocked provider transport. `npm run format` applies Prettier. `npm run format:check` checks it.

## Architecture

- `src/domain`: framework-independent user, provider, session, errors, repository port.
- `src/application`: identity/password/token ports and SignIn, Register, SessionIssuer, ValidateSession, SignOut use cases.
- `src/infrastructure`: validated environment, Mongo repository, Google/Meta verification, Argon2id and JWT adapters.
- `src/interfaces/http`: DTOs, thin controllers, reusable ActiveSessionGuard and sanitized error filter.
- `AuthModule`: dependency wiring; `AppModule`: configuration, database and rate limit.

Domain and application import neither NestJS nor Mongoose. External identities enter only through verified adapters. No service calls belong in controllers. No Redis, Kafka, microservices or cloud infrastructure.

## API

All successful authentication responses use HTTP 200:

```json
{
  "accessToken": "<Deep Drill JWT>",
  "expiresAt": "<ISO-8601 UTC timestamp>",
  "user": {
    "id": "<UUID>", "provider": "local",
    "username": "pilot_one", "displayName": "Pilot One",
    "gender": "unspecified", "email": null, "avatarUrl": null
  }
}
```

| Method / path | Request | Response |
| --- | --- | --- |
| POST `/api/v1/auth/sign-in` | `{ "provider": "google" or "facebook", "credential": "<provider token>" }` | Session above |
| POST `/api/v1/auth/sign-in/password` | `{ "username": "pilot_one", "password": "<passphrase>" }` | Session above |
| POST `/api/v1/auth/sign-up` | `{ "username": "pilot_one", "password": "<passphrase>", "displayName": "Pilot One", "gender": "unspecified" }` | Account + session above |
| POST `/api/v1/auth/sign-out` | Empty body, `Authorization: Bearer <Deep Drill JWT>` | `{ "success": true }` |
| GET `/api/v1/health` | None | `{ "status": "ok", "database": "up" }` |

Username/password support is the user's additional requirement and supersedes the original social-only scope. Usernames are ASCII letters/digits/underscore, 3–24 characters, case-insensitive. Passwords are 12–128 characters, never trimmed and never returned. Display name is 1–40 characters, trimmed, no control characters. Gender is optional: `female`, `male`, `non_binary`, `unspecified`; defaults to unspecified. It is a self-described pilot profile attribute, not verified biological data; it does not affect combat, balance or authentication. No birth date, address, telephone or real legal name is requested. Social providers do not supply this field.

Unknown request fields are rejected. No email existence endpoint. Wrong local password and unknown user return identical errors and both perform Argon2 verification. Duplicate username registration returns a generic registration failure; availability can still be inferred from successful registration (inherent for unique public usernames). There is no email-based login or automatic email linking.

Errors: `{ "statusCode": 401, "code": "AUTH_INVALID_CREDENTIAL", "message": "..." }`. Codes: AUTH_INVALID_PROVIDER (400), REQUEST_INVALID (400), AUTH_INVALID_CREDENTIAL (401), AUTH_EXPIRED_CREDENTIAL (401), AUTH_INVALID_SESSION (401), AUTH_SESSION_REVOKED (401), AUTH_REGISTRATION_FAILED (409), RATE_LIMITED (429), AUTH_PROVIDER_UNAVAILABLE (503), USER_PERSISTENCE_FAILURE (503). No raw provider response or request content is logged. Swagger documents schemas at `/api/docs` only when SWAGGER_ENABLED=true.

## Mongo / concurrency

Only `users` is created. Each document holds a UUID `_id`, `identityKeys[]`, `providers[]` (type, providerUserId, nullable email, verification flag, linkedAt), username, displayName, gender, nullable email/avatarUrl, optional Argon2id passwordHash, timestamps, lastLoginAt and bounded `sessions[]`.

`identityKeys` encodes each identity as canonical JSON `[provider,providerUserId]`. A unique single-field multikey index enforces that each identity belongs to one user, avoiding compound array cross-pair ambiguity. Social creation uses upsert and duplicate-key recovery. Index initialization finishes before the server starts accepting requests. Future explicit account linking must update providers and identityKeys atomically and reject duplicate keys; linking is not implemented now. Emails never identify or join accounts. Existing email is preserved when a provider omits it; nonempty validated provider name/avatar may update profile.

Session insertion is a single atomic aggregation update: removes expired/revoked entries, appends the session and keeps the most recent MAX_SESSIONS. Concurrent sign-ins cannot overwrite one another or grow the array indefinitely. At capacity the oldest session is evicted, so its next online request returns 401. Sessions store random UUID, createdAt, lastSeenAt, expiresAt and revokedAt. There is no separate sessions collection.

Passwords use Argon2id with 19 MiB memory, 2 iterations, parallelism 1 and per-hash random salt. No plaintext password, original social token, or Deep Drill JWT is stored in Mongo. Password hashes are excluded from normal Mongoose selections and all public responses. User profile is not a cloud save.

## Sessions / sign out

JWT uses HS256 and contains only `sub`, `sid`, `iat`, `exp`. JWT_EXPIRES_IN defaults to 30d (bounded 60s–90d). ActiveSessionGuard validates signature/expiry/claim shape AND an existing unexpired, unrevoked embedded session. It updates lastSeenAt. Apply the guard to every future protected endpoint. Sign-out atomically sets revokedAt; repeated sign-out returns 401. Session pruning may turn a revoked-session error into invalid-session; both mean sign in again.

Android stores only the Deep Drill session in AES-GCM encrypted storage with a nonexportable Android Keystore key, outside backup. A nonexpired local session allows offline gameplay; revocation cannot be discovered while offline. A future authenticated API 401 clears local session and routes to login. Failed remote sign-out still clears this device, but its remote session can remain active until expiration/eviction. No refresh token implemented.

## Environment

| Variable | Purpose |
| --- | --- |
| NODE_ENV | development / production |
| PORT | HTTP port, default 3000 |
| MONGODB_URI | Required Mongo connection string; never client-side |
| JWT_SECRET | Required random server-only secret, at least 32 bytes |
| JWT_EXPIRES_IN | 30d default; suffix s/m/h/d |
| MAX_SESSIONS | 1–20, default 10 |
| CORS_ORIGINS | Comma-separated explicit origins; empty permits no browser origins; no wildcard |
| AUTH_RATE_LIMIT / AUTH_RATE_TTL_MS | Per-IP requests per window, defaults 10 / 60000 |
| SWAGGER_ENABLED | Explicit true to expose docs |
| AUTH_GOOGLE_ENABLED / GOOGLE_CLIENT_ID | Enable configured Google verification; web/server OAuth client ID |
| AUTH_FACEBOOK_ENABLED | Enable configured Facebook verification |
| FACEBOOK_APP_ID / FACEBOOK_APP_SECRET | Meta application ID and server-only secret |
| FACEBOOK_GRAPH_API_VERSION | Explicit supported version, verified docs currently v26.0 |

Enabled providers must have complete configuration or startup fails. Disabled providers return a clear unavailable error; no fake production provider. Local registration works without social configuration. Helmet, strict DTO validation, 24 KiB JSON limit and in-process IP throttling apply. This limiter suits one backend instance; use trusted ingress/distributed limiting before scaling. Do not blindly enable Express trust proxy. Serve production through HTTPS; keep Mongo private and authenticated. Never log HTTP Authorization, credentials, passwords, provider URLs containing tokens or secret-bearing environment.

## Google Console and Android

1. Create/select a Google Cloud project; configure Google Auth Platform branding/audience and development test users.
2. Create Android OAuth clients for the exact application ID and signing SHA-1: debug `com.deepdrill.game.debug`, release `com.deepdrill.game`. Include Play App Signing certificate for store builds. Obtain your actual fingerprints with the client's `./gradlew :android:signingReport`; do not copy example fingerprints.
3. Create a **Web application OAuth client** in that project. Its client ID is the audience used by both backend GOOGLE_CLIENT_ID and Android GOOGLE_WEB_CLIENT_ID. Android OAuth client IDs are not this audience. No web client secret belongs in Android; no google-services.json/Firebase is required for this flow.
4. Set AUTH_GOOGLE_ENABLED=true after setting GOOGLE_CLIENT_ID. Put GOOGLE_WEB_CLIENT_ID in client local `auth.properties` (ignored) or Gradle user properties.
5. Android uses Credential Manager's explicit GetSignInWithGoogleOption, extracts the Google ID token and sends it over HTTPS. Backend google-auth-library verifyIdToken checks signature, issuer, expiration and audience and uses validated `sub` as identity. No password from Google ever reaches this API.

Official references checked for this implementation: [Android implementation](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation), [server verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Keystore](https://developer.android.com/privacy-and-security/keystore).

## Meta Console and Android

1. Create a Meta app with Facebook Login and configure its Android platform: package `com.deepdrill.game.debug` for debug or `com.deepdrill.game` for release, activity `com.deepdrill.android.AndroidLauncher`, actual signing key hashes. Add both relevant debug/release/Play certificates as applicable.
2. Derive the Base64 SHA-1 **key hash**, which differs from Google's colon-separated SHA-1, using your own signing keystore: `keytool -exportcert -alias <alias> -keystore <path> | openssl sha1 -binary | openssl base64`. Let keytool prompt for password; do not paste secrets into shell history.
3. Set appID/clientToken in Android's local auth.properties. The client token is intended for client SDK configuration; the App Secret is backend-only. Configure custom-tab callback scheme `fb<APP_ID>` (manifest derives it). Enable the provider's documented Android/native login settings; no handcrafted WebView/redirect server flow is used.
4. Set backend FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_GRAPH_API_VERSION (v26.0 in current official docs) and AUTH_FACEBOOK_ENABLED=true.
5. Request only public_profile and optional email. Configure test app roles/test users for development. Before public access complete Meta's required access/review, privacy policy and data deletion configuration in the dashboard; requirements depend on app/use case. Email may be declined or unavailable and is nullable.
6. Backend calls debug_token using app credentials, checks validity, application, user, expiration/data access expiration and public_profile scope, then calls me with appsecret_proof. It requires the same user ID and requests email only when granted. Avatar URLs are metadata only; backend never downloads them.

Official references: [Android SDK guide](https://developers.facebook.com/docs/facebook-login/android/), [debug_token](https://developers.facebook.com/docs/graph-api/reference/debug_token/), [Graph versions](https://developers.facebook.com/docs/graph-api/changelog/), [official SDK source](https://github.com/facebook/facebook-android-sdk). SDK automatic app events and advertiser ID collection are disabled in Android.

## Docker image

```sh
docker build -t deep-drill-backend .
# Supply a secure environment; from a container Mongo must be reachable via its network host.
docker run --rm --env-file .env -p 3000:3000 deep-drill-backend
```

Multi-stage Node 24 build, production dependencies only, non-root runtime. `.env` is excluded from both Git and Docker context. Docker Compose starts Mongo only; Docker image is optional. Never use localhost in a backend container to refer to another container.

## Manual acceptance and current limitations

For each configured social provider: install Android debug, login, verify one user/embedded session in Mongo, kill/reopen app to verify persistence, launch offline, reconnect, sign out, confirm revokedAt and login screen, login again and confirm same user ID. Inspect decoded Deep Drill claims locally without publishing tokens. Verify raw provider credential is absent from Mongo and client session file. Repeat local registration/login; check case-insensitive username and optional profile.

Real Google/Facebook end-to-end testing requires the app owner's Console configuration and development credentials. Automated tests replace providers and are not proof of a real OAuth round trip. No fake adapter is wired in this server. No deployment, password recovery/change, account deletion API, email verification, account linking, refresh tokens or cloud profile editing in this increment. Configure policy/deletion obligations before public social release. Current game progress remains device-local and shared by accounts on that installation; signing out neither deletes nor uploads it. Purchases, premium currency and cloud progression must become server-authoritative before sensitive online operations are added.

Future collections may include purchases, player-progress, transactions, entitlements, events; none are created. Complete payment history must have its own collection rather than embedding into users. Next features only: refresh/session strategy if needed, cloud progression, purchase validation, entitlements, player profile.

## Real Google login setup and validation

See [GOOGLE_AUTH_SETUP.md](GOOGLE_AUTH_SETUP.md). Current local status: **real Google end-to-end flow verified on Android API 35 emulator**. The correct Web OAuth Client ID is configured locally in both projects; the owner's replacement Android OAuth client works with the debug package and signing certificate. Real login, a unique Google user in Atlas, encrypted local session, restart persistence, logout/revocation and a second login using the same user with a distinct session were verified. Normal automated tests still mock Google.

```dotenv
# In ignored .env, only after obtaining the real Web application OAuth Client ID:
GOOGLE_CLIENT_ID=<WEB_OAUTH_CLIENT_ID>
AUTH_GOOGLE_ENABLED=true
```

The value must exactly match Android `GOOGLE_WEB_CLIENT_ID` / Credential Manager `serverClientId`. Never use the Android OAuth Client ID as audience. Preserve the existing Atlas connection and JWT secret. Restart after editing `.env`.

`npm run start:dev` binds to `0.0.0.0:3000`. A successful database ping logs `Mongo connected` without URI. `GET /api/v1/health` pings Mongo with a bounded timeout and returns `{"status":"ok","database":"up"}` or a sanitized 503. Completed Google sign-in logs only `Google authentication successful userId=<game UUID>`, never identity tokens, JWTs, credentials or email.

After a real Android login, copy only the game User ID from debug diagnostics and run `node scripts/verify-google-user.cjs <USER_ID>`. This read-only command checks `deep-drill.users`, Google identity presence and exactly one matching user; it prints only game/session UUIDs, timestamps and revocation state. Run before logout, after logout, and after another login: same user UUID, revoked old session, distinct new session. Do not feed tokens to scripts or store them as fixtures. Android session persistence, logout and duplicate checks after real Google authentication passed in the emulator on 2026-09-20.

The earlier error 28444 was resolved: an Android OAuth Client ID had been supplied as the Web audience. Replacing it with the actual Web Client ID enabled the complete real flow.

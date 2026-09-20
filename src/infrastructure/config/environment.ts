function integer(
  env: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(env[key] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`Invalid ${key}`);
  return n;
}
function flag(env: Record<string, unknown>, key: string): boolean {
  if (env[key] !== undefined && env[key] !== 'true' && env[key] !== 'false')
    throw new Error(`Invalid ${key}`);
  return env[key] === 'true';
}
export function validateEnvironment(env: Record<string, unknown>) {
  const required = (key: string): string => {
    const value = env[key];
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`Missing ${key}`);
    return value;
  };
  const secret = required('JWT_SECRET');
  if (Buffer.byteLength(secret) < 32 || secret.includes('change-me'))
    throw new Error('JWT_SECRET must contain at least 32 random bytes');
  const mongo = required('MONGODB_URI');
  if (!/^mongodb(?:\+srv)?:\/\//.test(mongo))
    throw new Error('Invalid MONGODB_URI');
  const lifetime = String(env.JWT_EXPIRES_IN ?? '30d');
  const match = /^(\d+)(s|m|h|d)$/.exec(lifetime);
  if (!match) throw new Error('JWT_EXPIRES_IN must use s, m, h or d');
  const seconds =
    Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]!] ?? 0);
  if (seconds < 60 || seconds > 90 * 86400)
    throw new Error('JWT_EXPIRES_IN must be between 60s and 90d');
  const google = flag(env, 'AUTH_GOOGLE_ENABLED'),
    facebook = flag(env, 'AUTH_FACEBOOK_ENABLED');
  if (
    google &&
    !required('GOOGLE_CLIENT_ID').endsWith('.apps.googleusercontent.com')
  )
    throw new Error('Invalid GOOGLE_CLIENT_ID');
  if (facebook) {
    if (!/^\d+$/.test(required('FACEBOOK_APP_ID')))
      throw new Error('Invalid FACEBOOK_APP_ID');
    required('FACEBOOK_APP_SECRET');
    if (!/^v\d+\.0$/.test(required('FACEBOOK_GRAPH_API_VERSION')))
      throw new Error('Invalid FACEBOOK_GRAPH_API_VERSION');
  }
  const cors = String(env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (cors.some((s) => s === '*' || !/^https?:\/\/[^/]+$/.test(s)))
    throw new Error('CORS_ORIGINS must contain explicit origins');
  return {
    ...env,
    JWT_SECRET: secret,
    MONGODB_URI: mongo,
    JWT_LIFETIME_SECONDS: seconds,
    PORT: integer(env, 'PORT', 3000, 1, 65535),
    MAX_SESSIONS: integer(env, 'MAX_SESSIONS', 10, 1, 20),
    AUTH_RATE_LIMIT: integer(env, 'AUTH_RATE_LIMIT', 10, 1, 1000),
    AUTH_RATE_TTL_MS: integer(env, 'AUTH_RATE_TTL_MS', 60000, 1000, 3600000),
    CORS_ORIGINS: cors,
    SWAGGER_ENABLED: flag(env, 'SWAGGER_ENABLED'),
    AUTH_GOOGLE_ENABLED: google,
    AUTH_FACEBOOK_ENABLED: facebook,
  };
}

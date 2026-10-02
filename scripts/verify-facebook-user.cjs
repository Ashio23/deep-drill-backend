// Read-only Atlas verification after real Facebook login. Input is a game UUID, never a token.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { MongoClient } = require('mongodb');
async function main() {
  const id = process.argv[2];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) throw new Error('Expected game UUID');
  const env = parseEnv(fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'));
  const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db();
    if (db.databaseName !== 'deep-drill') throw new Error('Unexpected database');
    const users = db.collection('users');
    const user = await users.findOne({ _id: id }, { projection: { providers: 1, sessions: 1, lastLoginAt: 1, email: 1 } });
    const identity = user?.providers.find(p => p.type === 'facebook');
    if (!identity?.providerUserId) throw new Error('No Facebook identity');
    const matchingUsers = await users.countDocuments({ providers: { $elemMatch: { type: 'facebook', providerUserId: identity.providerUserId } } });
    if (matchingUsers !== 1) throw new Error('Duplicate identity');
    console.log(JSON.stringify({ userId: id, provider: 'facebook', identityPresent: true, matchingUsers,
      emailPresent: Boolean(user.email), lastLoginAt: user.lastLoginAt,
      sessions: user.sessions.map(s => ({ id: s.id, expiresAt: s.expiresAt, revoked: s.revokedAt != null })) }, null, 2));
  } finally { await client.close(); }
}
main().catch(() => { console.error('Verification failed: check database availability and game UUID. No credentials logged.'); process.exitCode = 1; });

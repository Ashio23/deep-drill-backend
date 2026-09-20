import { randomUUID } from 'node:crypto';
import {
  AuthError,
  LocalRegistration,
  Provider,
  SocialProvider,
  User,
  UserRepository,
} from '../domain/auth';
import {
  IdentityProvider,
  PasswordHasher,
  TokenClaims,
  TokenIssuer,
} from './ports';
export interface AuthResponse {
  accessToken: string;
  expiresAt: string;
  user: {
    id: string;
    provider: Provider;
    displayName: string;
    username: string | null;
    gender: string;
    email: string | null;
    avatarUrl: string | null;
  };
}
export class SessionIssuer {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
    private readonly lifetimeSeconds: number,
    private readonly limit: number,
  ) {}
  async execute(user: User, provider: Provider): Promise<AuthResponse> {
    const now = new Date();
    const expiresAt = new Date(
      (Math.floor(now.getTime() / 1000) + this.lifetimeSeconds) * 1000,
    );
    const sid = randomUUID();
    const accessToken = this.tokens.issue({ sub: user.id, sid }, expiresAt);
    await this.users.appendSession(
      user.id,
      { id: sid, createdAt: now, lastSeenAt: now, revokedAt: null, expiresAt },
      this.limit,
    );
    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        provider,
        displayName: user.displayName,
        username: user.username,
        gender: user.gender,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
    };
  }
}
export class SignInUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly providers: Record<SocialProvider, IdentityProvider>,
    private readonly sessions: SessionIssuer,
    private readonly passwords: PasswordHasher,
  ) {}
  async social(
    provider: SocialProvider,
    credential: string,
  ): Promise<AuthResponse> {
    const adapter = this.providers[provider];
    if (!adapter) throw new AuthError('AUTH_INVALID_PROVIDER', 400);
    const identity = await adapter.validateCredential(credential);
    if (identity.provider !== provider || !identity.providerUserId)
      throw new AuthError('AUTH_INVALID_CREDENTIAL');
    return this.sessions.execute(
      await this.users.socialUser(identity),
      provider,
    );
  }
  async local(username: string, password: string): Promise<AuthResponse> {
    const user = await this.users.findLocal(username.toLowerCase());
    const valid = await this.passwords.verify(user?.passwordHash, password);
    if (!user || !valid) throw new AuthError('AUTH_INVALID_CREDENTIAL');
    return this.sessions.execute(user, Provider.Local);
  }
}
export class RegisterUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordHasher,
    private readonly sessions: SessionIssuer,
  ) {}
  async execute(input: LocalRegistration): Promise<AuthResponse> {
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.users.createLocal(
      {
        username: input.username.toLowerCase(),
        displayName: input.displayName.trim(),
        gender: input.gender,
      },
      passwordHash,
    );
    return this.sessions.execute(user, Provider.Local);
  }
}
export class ValidateSessionUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
  ) {}
  async execute(token: string): Promise<TokenClaims> {
    const claims = this.tokens.verify(token);
    await this.users.requireActiveSession(claims.sub, claims.sid, new Date());
    return claims;
  }
}
export class SignOutUseCase {
  constructor(private readonly users: UserRepository) {}
  async execute(claims: TokenClaims): Promise<{ success: true }> {
    await this.users.revokeSession(claims.sub, claims.sid, new Date());
    return { success: true };
  }
}

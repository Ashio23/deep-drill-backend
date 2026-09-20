export enum Provider {
  Google = 'google',
  Facebook = 'facebook',
  Local = 'local',
}
export type SocialProvider = Provider.Google | Provider.Facebook;
export type Gender = 'female' | 'male' | 'non_binary' | 'unspecified';
export interface ExternalIdentity {
  provider: SocialProvider;
  providerUserId: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  avatarUrl?: string;
}
export interface LinkedProvider {
  type: Provider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  linkedAt: Date;
}
export interface Session {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}
export interface User {
  id: string;
  providers: LinkedProvider[];
  displayName: string;
  username: string | null;
  gender: Gender;
  email: string | null;
  avatarUrl: string | null;
  passwordHash?: string;
  sessions: Session[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}
export class AuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 401,
  ) {
    super(code);
  }
}
export interface LocalRegistration {
  username: string;
  password: string;
  displayName: string;
  gender?: Gender;
}
export interface UserRepository {
  socialUser(identity: ExternalIdentity): Promise<User>;
  findLocal(username: string): Promise<User | null>;
  createLocal(
    input: Omit<LocalRegistration, 'password'>,
    passwordHash: string,
  ): Promise<User>;
  appendSession(userId: string, session: Session, limit: number): Promise<void>;
  requireActiveSession(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<void>;
  revokeSession(userId: string, sessionId: string, now: Date): Promise<void>;
}

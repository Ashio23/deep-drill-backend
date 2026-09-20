import { ExternalIdentity } from '../domain/auth';
export interface IdentityProvider {
  validateCredential(credential: string): Promise<ExternalIdentity>;
}
export interface TokenClaims {
  sub: string;
  sid: string;
}
export interface TokenIssuer {
  issue(claims: TokenClaims, expiresAt: Date): string;
  verify(token: string): TokenClaims;
}
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string | undefined, password: string): Promise<boolean>;
}

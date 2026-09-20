import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { AuthError, ExternalIdentity, Provider } from '../../domain/auth';
import { IdentityProvider } from '../../application/ports';
@Injectable()
export class GoogleIdentityProvider implements IdentityProvider {
  private readonly client = new OAuth2Client({
    transporterOptions: { timeout: 8000, retry: false },
  });
  constructor(private readonly config: ConfigService) {}
  async validateCredential(credential: string): Promise<ExternalIdentity> {
    if (!this.config.get<boolean>('AUTH_GOOGLE_ENABLED'))
      throw new AuthError('AUTH_PROVIDER_UNAVAILABLE', 503);
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) throw new AuthError('AUTH_INVALID_CREDENTIAL');
      if (payload.exp <= Math.floor(Date.now() / 1000))
        throw new AuthError('AUTH_EXPIRED_CREDENTIAL');
      return {
        provider: Provider.Google,
        providerUserId: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified,
        displayName: payload.name,
        avatarUrl: payload.picture,
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      // Never expose/log Google's error: it may contain the supplied credential.
      throw new AuthError('AUTH_INVALID_CREDENTIAL');
    }
  }
}

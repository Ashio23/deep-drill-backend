import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { AuthError, ExternalIdentity, Provider } from '../../domain/auth';
import { IdentityProvider } from '../../application/ports';
interface DebugToken {
  data?: {
    is_valid?: boolean;
    app_id?: string;
    type?: string;
    user_id?: string;
    expires_at?: number;
    data_access_expires_at?: number;
    scopes?: string[];
  };
}
interface FacebookProfile {
  id?: string;
  name?: string;
  email?: string;
  picture?: { data?: { url?: string } };
}
@Injectable()
export class FacebookIdentityProvider implements IdentityProvider {
  constructor(private readonly config: ConfigService) {}
  private async request<T>(
    path: string,
    parameters: Record<string, string>,
    bearer: string,
  ): Promise<T> {
    const url = new URL(
      `https://graph.facebook.com/${this.config.getOrThrow<string>('FACEBOOK_GRAPH_API_VERSION')}/${path}`,
    );
    Object.entries(parameters).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    );
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
    } catch {
      // Provider/network errors can contain credential-bearing URLs: never forward them.
      throw new AuthError('SERVER_UNAVAILABLE', 503);
    }
    if (response.status === 429 || response.status >= 500)
      throw new AuthError('SERVER_UNAVAILABLE', 503);
    if (!response.ok) throw new AuthError('AUTH_INVALID_CREDENTIAL');
    try {
      return (await response.json()) as T;
    } catch {
      throw new AuthError('SERVER_UNAVAILABLE', 503);
    }
  }
  async validateCredential(credential: string): Promise<ExternalIdentity> {
    if (!this.config.get<boolean>('AUTH_FACEBOOK_ENABLED'))
      throw new AuthError('AUTH_PROVIDER_UNAVAILABLE', 503);
    try {
      const appId = this.config.getOrThrow<string>('FACEBOOK_APP_ID'),
        secret = this.config.getOrThrow<string>('FACEBOOK_APP_SECRET');
      const { data } = await this.request<DebugToken>(
        'debug_token',
        { input_token: credential },
        `${appId}|${secret}`,
      );
      if (
        data?.is_valid !== true ||
        data.app_id !== appId ||
        data.type !== 'USER' ||
        typeof data.user_id !== 'string' ||
        !data.user_id.trim() ||
        !Array.isArray(data.scopes) ||
        !data.scopes.includes('public_profile')
      )
        throw new AuthError('AUTH_INVALID_CREDENTIAL');
      const now = Math.floor(Date.now() / 1000);
      if (
        typeof data.expires_at !== 'number' ||
        !Number.isSafeInteger(data.expires_at) ||
        data.expires_at <= now ||
        (data.data_access_expires_at !== undefined &&
          (typeof data.data_access_expires_at !== 'number' ||
            !Number.isSafeInteger(data.data_access_expires_at) ||
            (data.data_access_expires_at !== 0 &&
              data.data_access_expires_at <= now)))
      )
        throw new AuthError('AUTH_EXPIRED_CREDENTIAL');
      const fields =
        'id,name,picture' + (data.scopes.includes('email') ? ',email' : '');
      const profile = await this.request<FacebookProfile>(
        'me',
        {
          fields,
          appsecret_proof: createHmac('sha256', secret)
            .update(credential)
            .digest('hex'),
        },
        credential,
      );
      if (profile.id !== data.user_id)
        throw new AuthError('AUTH_INVALID_CREDENTIAL');
      return {
        provider: Provider.Facebook,
        providerUserId: data.user_id,
        displayName:
          typeof profile.name === 'string' ? profile.name : undefined,
        email: typeof profile.email === 'string' ? profile.email : undefined,
        avatarUrl:
          typeof profile.picture?.data?.url === 'string'
            ? profile.picture.data.url
            : undefined,
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('AUTH_INVALID_CREDENTIAL');
    }
  }
}

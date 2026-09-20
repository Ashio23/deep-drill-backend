import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthError } from '../../domain/auth';
import { TokenClaims, TokenIssuer } from '../../application/ports';
@Injectable()
export class JwtTokenIssuer implements TokenIssuer {
  constructor(private readonly jwt: JwtService) {}
  issue(claims: TokenClaims, expiresAt: Date): string {
    return this.jwt.sign(
      { ...claims, exp: Math.floor(expiresAt.getTime() / 1000) },
      { algorithm: 'HS256' },
    );
  }
  verify(token: string): TokenClaims {
    try {
      const claims = this.jwt.verify<Record<string, unknown>>(token, {
        algorithms: ['HS256'],
      });
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      if (
        typeof claims.sub !== 'string' ||
        !uuid.test(claims.sub) ||
        typeof claims.sid !== 'string' ||
        !uuid.test(claims.sid) ||
        typeof claims.exp !== 'number' ||
        typeof claims.iat !== 'number'
      )
        throw new Error();
      return { sub: claims.sub, sid: claims.sid };
    } catch {
      throw new AuthError('AUTH_INVALID_SESSION');
    }
  }
}

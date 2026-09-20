import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ValidateSessionUseCase } from '../../application/auth.use-cases';
import { TokenClaims } from '../../application/ports';
import { AuthError } from '../../domain/auth';
export interface AuthenticatedRequest extends Request {
  auth: TokenClaims;
}
@Injectable()
export class ActiveSessionGuard implements CanActivate {
  constructor(private readonly validateSession: ValidateSessionUseCase) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '');
    if (!match || match[1]!.length > 4096)
      throw new AuthError('AUTH_INVALID_SESSION');
    request.auth = await this.validateSession.execute(match[1]!);
    return true;
  }
}

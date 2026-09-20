import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthError } from '../../domain/auth';
const messages: Record<string, string> = {
  AUTH_INVALID_PROVIDER: 'Unsupported authentication provider.',
  AUTH_INVALID_CREDENTIAL:
    'Could not authenticate with the supplied credentials.',
  AUTH_EXPIRED_CREDENTIAL:
    'Authentication credential expired. Try signing in again.',
  AUTH_INVALID_SESSION: 'Please sign in again.',
  AUTH_SESSION_REVOKED: 'Please sign in again.',
  USER_PERSISTENCE_FAILURE: 'Account service temporarily unavailable.',
  AUTH_PROVIDER_UNAVAILABLE: 'This sign-in provider is not configured.',
  AUTH_REGISTRATION_FAILED: 'Could not create account. Try another username.',
  REQUEST_INVALID: 'Check the supplied fields.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  INTERNAL_ERROR: 'Service temporarily unavailable.',
};
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');
  catch(error: unknown, host: ArgumentsHost): void {
    let status = 500,
      code = 'INTERNAL_ERROR';
    if (error instanceof AuthError) {
      status = error.status;
      code = error.code;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code =
        status === 429
          ? 'RATE_LIMITED'
          : status === 400
            ? 'REQUEST_INVALID'
            : 'HTTP_ERROR';
    }
    // Do not log request URLs, bodies, headers, error objects or provider responses.
    if (status >= 500)
      this.logger.error({ event: 'request_failed', code, status });
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        statusCode: status,
        code,
        message: messages[code] ?? 'Request failed.',
      });
  }
}

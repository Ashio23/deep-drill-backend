import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { json, Request, Response, NextFunction } from 'express';
import { AuthError } from './domain/auth';
import { ApiErrorFilter } from './interfaces/http/error.filter';
import { configureSwagger } from './interfaces/http/swagger';
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  // Only the local Nginx hop is trusted; its template replaces incoming X-Forwarded-For.
  if (config.get<boolean>('TRUST_PROXY_LOOPBACK')) {
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  }
  app.use(helmet());
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      config.get<boolean>('MAINTENANCE_MODE') &&
      req.path.startsWith('/api/v1/auth/')
    ) {
      res.setHeader('Retry-After', '60');
      res.status(503).json({
        statusCode: 503,
        code: 'MAINTENANCE',
        message: 'Authentication temporarily unavailable during maintenance.',
      });
      return;
    }
    next();
  });
  app.use(json({ limit: '24kb' }));
  app.enableCors({
    origin: config.getOrThrow<string[]>('CORS_ORIGINS'),
    credentials: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      exceptionFactory: (errors) =>
        new AuthError(
          errors.some((e) => e.property === 'provider')
            ? 'AUTH_INVALID_PROVIDER'
            : 'REQUEST_INVALID',
          400,
        ),
    }),
  );
  app.useGlobalFilters(new ApiErrorFilter());
  if (config.get<boolean>('SWAGGER_ENABLED')) {
    configureSwagger(app);
  }
}

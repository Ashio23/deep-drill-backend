import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json } from 'express';
import { AuthError } from './domain/auth';
import { ApiErrorFilter } from './interfaces/http/error.filter';
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.use(helmet());
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
    const options = new DocumentBuilder()
      .setTitle('Deep Drill API')
      .setVersion('1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, options),
    );
  }
}

import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Deep Drill API')
    .setDescription(
      'Authentication and session API for Deep Drill. All API routes use ' +
        '/api/v1. Register or sign in to obtain an accessToken, then paste ' +
        'that token into Authorize to call protected endpoints. Social sign-in ' +
        'requires a real Google ID token or Facebook access token and an enabled ' +
        'provider. Try it out sends real requests and can create accounts or revoke sessions.',
    )
    .setVersion('1')
    .addTag('Authentication', 'Registration, sign-in and session revocation.')
    .addTag('Health', 'Application and MongoDB availability.')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Deep Drill accessToken returned by registration or sign-in. Paste only the token, without the Bearer prefix.',
    })
    .build();

  SwaggerModule.setup(
    'api/docs',
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      jsonDocumentUrl: 'api/docs-json',
      yamlDocumentUrl: 'api/docs-yaml',
      customSiteTitle: 'Deep Drill API · Swagger',
      swaggerOptions: {
        filter: true,
        docExpansion: 'none',
        displayRequestDuration: true,
        persistAuthorization: false,
        validatorUrl: null,
      },
    },
  );
}

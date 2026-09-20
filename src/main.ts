import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { HealthController } from './interfaces/http/health.controller';
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: new ConsoleLogger({ json: true }),
  });
  configureApp(app);
  app.enableShutdownHooks();
  await app.get(HealthController).health();
  Logger.log('Mongo connected', 'Bootstrap');
  await app.listen(
    app.get(ConfigService).getOrThrow<number>('PORT'),
    '0.0.0.0',
  );
}
void bootstrap().catch(() => {
  process.stderr.write(
    'Backend could not start; check environment and Mongo availability.\n',
  );
  process.exitCode = 1;
});

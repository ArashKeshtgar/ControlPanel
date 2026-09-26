import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { validateJwtSecrets } from './auth/jwt-config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  validateJwtSecrets(app.get(ConfigService));

  app.enableCors({ origin: 'http://localhost:4100' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Control Panel — core-api')
    .setDescription('Auth, RBAC and cross-project aggregation for the portfolio control panel')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(4000);
  console.log('core-api listening on http://localhost:4000 (Swagger at /docs)');
}

bootstrap();

import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'ecom-api',
      mode: process.env.ECOM_MODE ?? 'MOCK',
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [HealthController] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.APP_URL ?? 'http://localhost:3000' });
  await app.listen(Number(process.env.API_PORT ?? 4000));
}

void bootstrap();

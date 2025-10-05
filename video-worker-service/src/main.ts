import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  console.log('========================================');
  console.log('🎬 Video Worker Service Started');
  console.log('========================================');
  console.log('Waiting for video processing jobs...');
  console.log('Press Ctrl+C to stop');
  console.log('========================================');
}
bootstrap();

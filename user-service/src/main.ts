import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // Add global request logger
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log(`   Headers:`, req.headers);
    next();
  });
  
  // Serve static files với CORS headers
  const uploadsPath = join(__dirname, '..', 'uploads');
  console.log('Serving static files from:', uploadsPath);
  
  app.use('/uploads', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }, express.static(uploadsPath));
  
  // Enable CORS cho Flutter app
  app.enableCors({
    origin: true, // Cho phép tất cả origin trong development
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });
  
  // Enable validation globally
  app.useGlobalPipes(new ValidationPipe());
  
  await app.listen(process.env.PORT ?? 3000);
  console.log('User service is running on http://localhost:3000');
  console.log('Static files available at http://localhost:3000/uploads/');
}
bootstrap();

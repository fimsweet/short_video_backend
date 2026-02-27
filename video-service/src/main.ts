import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import * as express from 'express';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Enable global validation pipe with transform
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // Enable CORS for Flutter web
  app.enableCors({
    origin: true, // Allow all origins in development
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // Serve static files
  const uploadsPath = join(__dirname, '..', 'uploads');
  console.log('Serving static files from:', uploadsPath);

  app.use('/uploads', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }, express.static(uploadsPath));

  // ============================================
  // Serve processed videos (HLS segments, thumbnails)
  // ============================================
  // Local dev: worker writes to ../video-worker-service/processed_videos/
  // Docker: worker writes to /app/uploads/processed_videos/ (shared volume)
  // S3 mode: files served via CloudFront — this handler is backup only
  // ============================================
  const processedVideosPathLocal = join(__dirname, '..', '..', 'video-worker-service', 'processed_videos');
  const processedVideosPathDocker = join(__dirname, '..', 'uploads', 'processed_videos');
  
  // Use Docker path if it exists, otherwise local dev path
  const processedVideosPath = fs.existsSync(processedVideosPathDocker)
    ? processedVideosPathDocker
    : processedVideosPathLocal;
  
  console.log('Serving processed videos from:', processedVideosPath);
  console.log('Path exists?', fs.existsSync(processedVideosPath));

  app.use('/uploads/processed_videos', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');

    // Set proper content type for HLS and images
    if (req.url.endsWith('.m3u8')) {
      res.header('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (req.url.endsWith('.ts')) {
      res.header('Content-Type', 'video/mp2t');
    } else if (req.url.endsWith('.jpg') || req.url.endsWith('.jpeg')) {
      res.header('Content-Type', 'image/jpeg');
    } else if (req.url.endsWith('.png')) {
      res.header('Content-Type', 'image/png');
    }

    next();
  }, express.static(processedVideosPath));

  // Serve chat images
  const chatImagesPath = join(__dirname, '..', 'uploads', 'chat_images');
  app.use('/uploads/chat_images', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }, express.static(chatImagesPath));

  console.log('Chat images served from:', chatImagesPath);

  const port = process.env.PORT || 3002;
  await app.listen(port);

  console.log(`Video service is running on http://localhost:${port}`);
  console.log(`WebSocket available at ws://localhost:${port}/chat`);
}
bootstrap();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as express from 'express';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  // Serve static files for processed videos from video-worker-service
  const processedVideosPath = join(__dirname, '..', '..', 'video-worker-service', 'processed_videos');
  console.log('Serving processed videos from:', processedVideosPath);
  console.log('Path exists?', fs.existsSync(processedVideosPath));
  
  if (fs.existsSync(processedVideosPath)) {
    const folders = fs.readdirSync(processedVideosPath);
    console.log('Folders in processed_videos:', folders);
    
    // Log thumbnail files
    folders.forEach(folder => {
      const folderPath = join(processedVideosPath, folder);
      if (fs.statSync(folderPath).isDirectory()) {
        const files = fs.readdirSync(folderPath);
        console.log(`  ${folder}:`, files);
      }
    });
  }
  
  app.use('/uploads/processed_videos', (req, res, next) => {
    console.log('📥 Serving file:', req.url);
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    
    // Set proper content type for images
    if (req.url.endsWith('.jpg') || req.url.endsWith('.jpeg')) {
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

  const port = process.env.PORT || 3001;
  await app.listen(port);
  
  console.log(`🚀 Video service is running on http://localhost:${port}`);
  console.log(`🔌 WebSocket available at ws://localhost:${port}/chat`);
}
bootstrap();

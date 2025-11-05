import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { join } from 'path';
import * as express from 'express';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve static files for raw videos (uploaded files)
  const uploadsPath = join(__dirname, '..', 'uploads');
  app.use('/uploads/raw_videos', express.static(join(uploadsPath, 'raw_videos')));

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

  // Enable CORS
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // Enable validation
  app.useGlobalPipes(new ValidationPipe());

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Video Service is running on http://localhost:${port}`);
  console.log(`Static files available at http://localhost:${port}/uploads/`);
}
bootstrap();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS cho Flutter app - sửa lỗi origin
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Whitelist of allowed origins
      const whitelist = [
        'http://localhost:59294', 
        'http://127.0.0.1:59294', 
        'http://10.0.2.2:3000', 
        'http://localhost:3000'
      ];

      // Allow all localhost origins for development
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
      }

      if (whitelist.indexOf(origin) !== -1) {
        return callback(null, true);
      }
      
      callback(new Error('Not allowed by CORS'));
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });
  
  // Enable validation globally
  app.useGlobalPipes(new ValidationPipe());
  
  await app.listen(process.env.PORT ?? 3000);
  console.log('User service is running on http://localhost:3000');
}
bootstrap();

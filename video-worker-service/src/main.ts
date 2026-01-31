import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Port cho health checks (K8s liveness/readiness probes)
  const port = process.env.PORT || 3003;
  await app.listen(port);
  
  console.log('========================================');
  console.log('Video Worker Service Started');
  console.log(`Health endpoint: http://localhost:${port}/health`);
  console.log('========================================');
  console.log('Waiting for video processing jobs...');
  console.log('Press Ctrl+C to stop');
  console.log('========================================');

  // Graceful shutdown handlers for K8s
  const signals = ['SIGTERM', 'SIGINT'];
  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`\n[SHUTDOWN] Received ${signal}, shutting down gracefully...`);
      await app.close();
      process.exit(0);
    });
  });
}
bootstrap();

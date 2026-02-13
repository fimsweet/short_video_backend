import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // ============================================
  // PORT CONFIGURATION
  // ============================================
  // Normal mode (EC2/K8s): Fixed port 3003 for health checks
  // Batch mode: Port 0 = OS picks a random available port
  //   → Prevents EADDRINUSE when AWS Batch runs multiple
  //     containers on the same EC2 instance
  // ============================================
  const isBatchMode = process.env.BATCH_MODE === 'true';
  const port = isBatchMode ? 0 : (process.env.PORT || 3003);
  await app.listen(port);

  // Get the actual port assigned (important for port=0)
  const server = app.getHttpServer();
  const actualPort = server.address()?.port || port;
  
  console.log('========================================');
  console.log('Video Worker Service Started');
  console.log(`Mode: ${isBatchMode ? 'AWS BATCH' : 'NORMAL'}`);
  console.log(`Health endpoint: http://localhost:${actualPort}/health`);
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

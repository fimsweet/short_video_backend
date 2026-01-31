import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessorModule } from './processor/processor.module';
import { StorageModule } from './config/storage.module';
import { HealthModule } from './health/health.module';
import { getDatabaseConfig } from './config/database.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getDatabaseConfig,
      inject: [ConfigService],
    }),
    StorageModule, // AWS S3 storage (global)
    ProcessorModule,
    HealthModule, // K8s health checks
  ],
})
export class AppModule {}

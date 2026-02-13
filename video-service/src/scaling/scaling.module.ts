// ============================================
// SCALING MODULE
// ============================================
// Registers the AWS Batch auto-scaling service and controller
// This module handles automatic worker scaling based on queue depth
// ============================================

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BatchScalingService } from '../config/batch-scaling.service';
import { ScalingController } from './scaling.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(), // Required for @Cron decorator in BatchScalingService
  ],
  controllers: [ScalingController],
  providers: [BatchScalingService],
  exports: [BatchScalingService],
})
export class ScalingModule {}

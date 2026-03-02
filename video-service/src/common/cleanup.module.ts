import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CleanupService } from './cleanup.service';

/**
 * Module for managing automated cleanup tasks
 * - Deletes temporary files older than 24 hours
 * - Runs on schedule (3AM daily + every 6 hours)
 */
@Module({
  imports: [
    ScheduleModule.forRoot(), // Enable NestJS scheduler
  ],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class CleanupModule {}

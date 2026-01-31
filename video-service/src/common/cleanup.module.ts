import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CleanupService } from './cleanup.service';

/**
 * Module quản lý các tác vụ dọn dẹp tự động
 * - Xóa file tạm cũ hơn 24h
 * - Chạy theo schedule (3AM daily + every 6 hours)
 */
@Module({
  imports: [
    ScheduleModule.forRoot(), // Enable NestJS scheduler
  ],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class CleanupModule {}

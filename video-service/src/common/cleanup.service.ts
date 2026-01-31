import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ============================================
 * 🧹 CLEANUP SERVICE
 * ============================================
 * Giải quyết vấn đề: File rác tích tụ khi upload/processing lỗi
 * 
 * Các thư mục được dọn dẹp:
 * - ./uploads/temp: File chunk tạm khi upload
 * - ./uploads/raw_videos: Video gốc chờ xử lý (nếu worker chưa kịp xóa)
 * - ./uploads/thumbnails: Thumbnail tạm
 * 
 * Schedule: Chạy mỗi ngày lúc 3:00 AM
 * Rule: Xóa file cũ hơn 24 giờ
 * ============================================
 */
@Injectable()
export class CleanupService implements OnModuleInit {
  private readonly logger = new Logger(CleanupService.name);
  
  // Các thư mục cần dọn dẹp
  private readonly tempDirs = [
    './uploads/temp',
    './uploads/raw_videos', 
    './uploads/thumbnails',
    './uploads/chunks',
  ];

  // Thời gian giữ file (24 giờ)
  private readonly MAX_FILE_AGE_MS = 24 * 60 * 60 * 1000;

  onModuleInit() {
    this.logger.log('🧹 Cleanup Service initialized');
    this.logger.log(`   Monitoring directories: ${this.tempDirs.join(', ')}`);
    this.logger.log(`   Max file age: 24 hours`);
    this.logger.log(`   Schedule: Daily at 3:00 AM`);
    
    // Run cleanup on startup (in case server was down for a while)
    this.runCleanup();
  }

  /**
   * Chạy mỗi ngày lúc 3:00 AM
   * Thời điểm ít traffic nhất, phù hợp để chạy maintenance tasks
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  handleScheduledCleanup() {
    this.logger.log('🧹 Starting scheduled cleanup (3:00 AM daily job)...');
    this.runCleanup();
  }

  /**
   * Chạy mỗi 6 giờ để đảm bảo không tích tụ quá nhiều file
   * Đây là backup cho trường hợp server restart sau 3AM
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  handlePeriodicCleanup() {
    this.logger.log('🧹 Starting periodic cleanup (every 6 hours)...');
    this.runCleanup();
  }

  /**
   * Core cleanup logic
   */
  private runCleanup(): void {
    const cutoffTime = Date.now() - this.MAX_FILE_AGE_MS;
    let totalDeleted = 0;
    let totalSize = 0;

    for (const dir of this.tempDirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }

      try {
        const result = this.cleanDirectory(dir, cutoffTime);
        totalDeleted += result.deletedCount;
        totalSize += result.deletedSize;
      } catch (error) {
        this.logger.error(`Failed to clean directory ${dir}: ${error.message}`);
      }
    }

    if (totalDeleted > 0) {
      const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
      this.logger.log(`✅ Cleanup completed: Deleted ${totalDeleted} files (${sizeInMB} MB freed)`);
    } else {
      this.logger.log('✅ Cleanup completed: No old files found');
    }
  }

  /**
   * Clean a single directory recursively
   */
  private cleanDirectory(dir: string, cutoffTime: number): { deletedCount: number; deletedSize: number } {
    let deletedCount = 0;
    let deletedSize = 0;

    const items = fs.readdirSync(dir);

    for (const item of items) {
      const itemPath = path.join(dir, item);
      
      try {
        const stats = fs.statSync(itemPath);
        
        if (stats.isDirectory()) {
          // Recursively clean subdirectory
          const subResult = this.cleanDirectory(itemPath, cutoffTime);
          deletedCount += subResult.deletedCount;
          deletedSize += subResult.deletedSize;
          
          // Remove empty directories
          const remaining = fs.readdirSync(itemPath);
          if (remaining.length === 0) {
            fs.rmdirSync(itemPath);
            this.logger.debug(`Removed empty directory: ${itemPath}`);
          }
        } else if (stats.mtimeMs < cutoffTime) {
          // File is older than cutoff time - delete it
          deletedSize += stats.size;
          fs.unlinkSync(itemPath);
          deletedCount++;
          this.logger.debug(`Deleted old file: ${itemPath} (age: ${this.formatAge(Date.now() - stats.mtimeMs)})`);
        }
      } catch (error) {
        this.logger.warn(`Could not process ${itemPath}: ${error.message}`);
      }
    }

    return { deletedCount, deletedSize };
  }

  /**
   * Format age in human-readable format
   */
  private formatAge(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  /**
   * Manual cleanup trigger (for admin API)
   */
  async triggerManualCleanup(): Promise<{ deletedCount: number; deletedSize: number }> {
    this.logger.log('🧹 Manual cleanup triggered...');
    
    const cutoffTime = Date.now() - this.MAX_FILE_AGE_MS;
    let totalDeleted = 0;
    let totalSize = 0;

    for (const dir of this.tempDirs) {
      if (fs.existsSync(dir)) {
        const result = this.cleanDirectory(dir, cutoffTime);
        totalDeleted += result.deletedCount;
        totalSize += result.deletedSize;
      }
    }

    return { deletedCount: totalDeleted, deletedSize: totalSize };
  }

  /**
   * Get disk usage stats for monitoring
   */
  getDiskStats(): { directory: string; fileCount: number; totalSize: number }[] {
    const stats: { directory: string; fileCount: number; totalSize: number }[] = [];

    for (const dir of this.tempDirs) {
      if (!fs.existsSync(dir)) {
        stats.push({ directory: dir, fileCount: 0, totalSize: 0 });
        continue;
      }

      const { count, size } = this.countFilesRecursive(dir);
      stats.push({ directory: dir, fileCount: count, totalSize: size });
    }

    return stats;
  }

  private countFilesRecursive(dir: string): { count: number; size: number } {
    let count = 0;
    let size = 0;

    const items = fs.readdirSync(dir);
    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        const sub = this.countFilesRecursive(itemPath);
        count += sub.count;
        size += sub.size;
      } else {
        count++;
        size += stats.size;
      }
    }

    return { count, size };
  }
}

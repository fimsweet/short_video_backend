import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as amqp from 'amqplib';
import * as path from 'path';
import * as fs from 'fs';
import { Video, VideoStatus } from '../entities/video.entity';
import { StorageService } from '../config/storage.service';
import { AiAnalysisService } from '../config/ai-analysis.service';

// Import fluent-ffmpeg correctly
const ffmpeg = require('fluent-ffmpeg');

@Injectable()
export class VideoProcessorService implements OnModuleInit, OnModuleDestroy {
  private rabbitMQUrl: string;
  private queueName: string;
  private processedDir: string;
  private videoServiceUrl: string;
  
  // ============================================
  // Connection management for graceful shutdown
  // ============================================
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private isShuttingDown = false;
  private currentJobCount = 0;
  private retryCount = 0;
  private readonly MAX_RETRIES = 10;
  private isReconnecting = false; // Prevent concurrent reconnect attempts

  // ============================================
  // AWS BATCH MODE - Auto-exit when idle
  // ============================================
  // When running as an AWS Batch job, the worker should
  // automatically exit when the queue is empty to release
  // the EC2 instance and save costs.
  // Set BATCH_MODE=true and AUTO_EXIT_WHEN_IDLE=true
  // ============================================
  private isBatchMode = false;
  private autoExitWhenIdle = false;
  private idleTimeoutSeconds = 60;
  private lastJobCompletedAt = 0;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private totalJobsProcessed = 0;
  
  // ============================================
  // FFmpeg process tracking for graceful shutdown
  // ============================================
  // Luu reference t?i FFmpeg process dang ch?y d? c� th? kill khi shutdown
  private activeFFmpegProcesses: Map<string, any> = new Map();

  constructor(
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
    private configService: ConfigService,
    private httpService: HttpService,
    private storageService: StorageService,
    private aiAnalysisService: AiAnalysisService,
  ) {
    this.rabbitMQUrl = this.configService.get<string>('RABBITMQ_URL') || 'amqp://admin:password@localhost:5672';
    this.queueName = this.configService.get<string>('RABBITMQ_QUEUE') || 'video_processing_queue';
    this.processedDir = this.configService.get<string>('PROCESSED_VIDEOS_PATH') || './processed_videos';
    this.videoServiceUrl = this.configService.get<string>('VIDEO_SERVICE_URL') || 'http://localhost:3002';

    // AWS Batch mode configuration
    this.isBatchMode = this.configService.get<string>('BATCH_MODE') === 'true';
    this.autoExitWhenIdle = this.configService.get<string>('AUTO_EXIT_WHEN_IDLE') === 'true';
    this.idleTimeoutSeconds = parseInt(
      this.configService.get<string>('IDLE_TIMEOUT_SECONDS') || '60',
      10,
    );
  }

  async onModuleInit() {
    // T?o thu m?c processed_videos n?u chua c�
    if (!fs.existsSync(this.processedDir)) {
      fs.mkdirSync(this.processedDir, { recursive: true });
    }

    // ============================================
    // AWS BATCH MODE LOGGING
    // ============================================
    if (this.isBatchMode) {
      console.log('============================================');
      console.log('  AWS BATCH MODE ACTIVE');
      console.log('============================================');
      console.log(`  Auto-exit when idle: ${this.autoExitWhenIdle}`);
      console.log(`  Idle timeout: ${this.idleTimeoutSeconds}s`);
      console.log(`  This worker will automatically terminate`);
      console.log(`  when the queue is empty to save costs.`);
      console.log('============================================');
    }

    // Bắt đầu lắng nghe RabbitMQ queue
    await this.startWorker();

    // ============================================
    // START IDLE MONITOR (AWS Batch only)
    // ============================================
    // Periodically checks if the worker has been idle
    // for too long and exits if so
    // ============================================
    if (this.autoExitWhenIdle) {
      this.lastJobCompletedAt = Date.now();
      this.idleCheckInterval = setInterval(async () => {
        await this.checkIdleAndExit();
      }, 10000); // Check every 10 seconds
    }
  }

  // ============================================
  // Graceful Shutdown for Kubernetes
  // ============================================
  async onModuleDestroy() {
    console.log('[SHUTDOWN] Received shutdown signal, gracefully stopping worker...');
    this.isShuttingDown = true;

    // Clear idle check interval (AWS Batch mode)
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    // Cancel consumer để không nhận job mới
    if (this.channel) {
      try {
        await this.channel.cancel('video-worker-consumer');
        console.log('   Stopped accepting new jobs');
      } catch (e) {
        // Ignore
      }
    }

    // Đợi job hiện tại hoàn thành (max 60s)
    const maxWait = 60;
    let waited = 0;
    while (this.currentJobCount > 0 && waited < maxWait) {
      console.log(`   Waiting for ${this.currentJobCount} job(s) to complete... (${waited}s/${maxWait}s)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      waited++;
    }

    // ============================================
    // Kill zombie FFmpeg processes nếu timeout
    // ============================================
    if (this.activeFFmpegProcesses.size > 0) {
      console.warn(`[WARN] Killing ${this.activeFFmpegProcesses.size} hanging FFmpeg process(es)...`);
      for (const [videoId, ffmpegCommand] of this.activeFFmpegProcesses) {
        try {
          ffmpegCommand.kill('SIGKILL');
          console.log(`   Killed FFmpeg for video ${videoId}`);
        } catch (e) {
          // Process might already be dead
        }
      }
      this.activeFFmpegProcesses.clear();
    }

    if (this.channel) {
      try {
        await this.channel.close();
      } catch (e) {
        // Ignore
      }
    }
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (e) {
        // Ignore
      }
    }

    console.log('[OK] Worker shutdown complete');
  }

  // ============================================
  // AWS BATCH: Auto-exit when idle
  // ============================================
  // When running as an AWS Batch job, the worker should
  // exit when queue is empty to release the EC2 instance.
  // This saves costs by only running compute when needed.
  //
  // Flow:
  // 1. AWS Batch starts worker container
  // 2. Worker processes all messages in queue
  // 3. Queue becomes empty → idle timer starts
  // 4. After IDLE_TIMEOUT_SECONDS of inactivity → exit
  // 5. AWS Batch marks job as SUCCEEDED
  // 6. If no more jobs in Batch queue → EC2 terminates
  // ============================================
  private async checkIdleAndExit(): Promise<void> {
    if (this.isShuttingDown || this.currentJobCount > 0) return;

    const idleTime = (Date.now() - this.lastJobCompletedAt) / 1000;

    if (idleTime >= this.idleTimeoutSeconds) {
      // Double-check: verify queue is actually empty
      try {
        if (this.channel) {
          const queueInfo = await this.channel.checkQueue(this.queueName);
          if (queueInfo.messageCount > 0) {
            // Queue has messages, don't exit yet
            console.log(`[BATCH] Queue still has ${queueInfo.messageCount} message(s), continuing...`);
            this.lastJobCompletedAt = Date.now(); // Reset timer
            return;
          }
        }
      } catch (error) {
        // If we can't check queue, exit anyway (safer for cost)
        console.warn(`[BATCH] Could not check queue: ${error.message}`);
      }

      console.log('============================================');
      console.log('  AWS BATCH: AUTO-EXIT (Queue Empty)');
      console.log('============================================');
      console.log(`  Idle time: ${idleTime.toFixed(0)}s`);
      console.log(`  Threshold: ${this.idleTimeoutSeconds}s`);
      console.log(`  Jobs processed: ${this.totalJobsProcessed}`);
      console.log(`  Reason: No messages in queue`);
      console.log(`  Action: Exiting to release EC2 instance`);
      console.log('============================================');

      // Clean shutdown
      this.isShuttingDown = true;
      if (this.idleCheckInterval) {
        clearInterval(this.idleCheckInterval);
      }

      // Give 5 seconds for cleanup then exit
      setTimeout(() => {
        console.log('[BATCH] Worker exiting with code 0 (SUCCESS)');
        process.exit(0);
      }, 5000);
    }
  }

  /**
   * Attach connection + channel error/close handlers for robust reconnection.
   * CRITICAL for cloud environments where TCP connections can be silently dropped
   * by firewalls, load balancers, or RabbitMQ restarts.
   */
  private attachConnectionHandlers(): void {
    if (!this.connection || !this.channel) return;

    this.connection.on('error', (err) => {
      console.error('[ERROR] RabbitMQ connection error:', err.message);
      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      }
    });

    this.connection.on('close', () => {
      console.warn('[WARN] RabbitMQ connection closed');
      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      }
    });

    this.channel.on('error', (err) => {
      console.error('[ERROR] RabbitMQ channel error:', err.message);
    });

    // CRITICAL FIX: Channel close MUST trigger reconnect.
    // In cloud environments, the channel can die independently of the connection
    // (e.g., heartbeat timeout, server-initiated close, consumer_timeout).
    // Without this, the worker becomes a zombie — connection alive but no consumer.
    this.channel.on('close', () => {
      console.warn('[WARN] RabbitMQ channel closed — triggering reconnect');
      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Safely close existing connection before reconnecting.
   * Prevents leaked TCP sockets and file descriptor exhaustion.
   */
  private async cleanupConnection(): Promise<void> {
    try {
      if (this.channel) {
        // Remove listeners to prevent triggering reconnect during cleanup
        this.channel.removeAllListeners();
        await this.channel.close().catch(() => {});
        this.channel = null;
      }
    } catch (e) { /* ignore */ }
    try {
      if (this.connection) {
        this.connection.removeAllListeners();
        await this.connection.close().catch(() => {});
        this.connection = null;
      }
    } catch (e) { /* ignore */ }
  }

  private async startWorker(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isReconnecting = false;
    
    console.log('Video Worker Service started. Waiting for jobs...');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Cleanup any stale connection before connecting
    await this.cleanupConnection();

    try {
      // ============================================
      // HEARTBEAT: Detect dead connections in cloud
      // ============================================
      // Without heartbeat (default=0), firewalls/LBs can silently kill
      // idle TCP connections. Heartbeat=30s sends AMQP heartbeat frames
      // every 30s. If 2 consecutive beats are missed (60s), the client
      // detects the dead connection and triggers reconnect.
      // ============================================
      const connectUrl = this.rabbitMQUrl.includes('?')
        ? `${this.rabbitMQUrl}&heartbeat=30`
        : `${this.rabbitMQUrl}?heartbeat=30`;

      this.connection = await amqp.connect(connectUrl);
      this.channel = await this.connection.createChannel();

      // Attach error/close handlers (including channel close → reconnect)
      this.attachConnectionHandlers();

      // Reset retry count on successful connection
      this.retryCount = 0;

      // ============================================
      // DLQ Setup - Always try to create with DLQ args
      // ============================================
      const dlqName = `${this.queueName}_dlq`;
      let dlqEnabled = true;
      
      try {
        // Create DLQ first
        await this.channel.assertQueue(dlqName, { durable: true });
        
        // Create main queue with DLQ routing
        // If queue exists with SAME args → OK
        // If queue exists with DIFFERENT args → will throw error
        await this.channel.assertQueue(this.queueName, { 
          durable: true,
          arguments: {
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': dlqName,
          }
        });
        console.log(`[OK] Queue ready with DLQ support: ${this.queueName}`);
      } catch (assertError) {
        // Queue exists with different args (no DLQ) - fallback to simple queue
        console.warn(`[WARN] Could not create queue with DLQ (queue exists with different args)`);
        console.warn(`   To enable DLQ: Delete queue "${this.queueName}" in RabbitMQ and restart`);
        
        // ============================================
        //  PRODUCTION WARNING: DLQ is critical!
        // ============================================
        if (process.env.NODE_ENV === 'production') {
          console.error(` ------------------------------------------------------------`);
          console.error(` CRITICAL: Running production WITHOUT Dead Letter Queue!`);
          console.error(` Failed videos will be LOST permanently.`);
          console.error(` `);
          console.error(` To fix: Delete queue "${this.queueName}" in RabbitMQ Management UI`);
          console.error(` URL: http://localhost:15672 (or your RabbitMQ host)`);
          console.error(` Then restart this worker service.`);
          console.error(` ------------------------------------------------------------`);
        }
        
        // Reconnect because channel is closed after assertQueue fails
        await this.cleanupConnection();
        const fallbackUrl = this.rabbitMQUrl.includes('?')
          ? `${this.rabbitMQUrl}&heartbeat=30`
          : `${this.rabbitMQUrl}?heartbeat=30`;
        this.connection = await amqp.connect(fallbackUrl);
        this.channel = await this.connection.createChannel();
        
        // Attach ALL handlers again (including channel close → reconnect)
        this.attachConnectionHandlers();
        
        // Use existing queue without DLQ
        await this.channel.assertQueue(this.queueName, { durable: true });
        dlqEnabled = false;
      }
      
      await this.setupConsumer(this.channel, dlqName, dlqEnabled);
    } catch (error) {
      console.error('[-] Worker could not connect to RabbitMQ:', error.message || error);
      this.scheduleReconnect();
    }
  }

  // ============================================
  // Exponential backoff with jitter for reconnection
  // ============================================
  // Jitter prevents "thundering herd" when multiple workers
  // (e.g., K8s pods or Batch containers) reconnect simultaneously
  // after a RabbitMQ restart, spreading the load.
  // ============================================
  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.isReconnecting) return;
    this.isReconnecting = true;
    
    this.retryCount++;
    if (this.retryCount > this.MAX_RETRIES) {
      console.error(`[ERROR] Max retries (${this.MAX_RETRIES}) exceeded. Giving up.`);
      process.exit(1); // Let K8s/Batch restart the container
    }
    
    // Exponential backoff with jitter: base * 2^(retry-1) + random(0-1000ms), max 30s
    const baseDelay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30000);
    const jitter = Math.floor(Math.random() * 1000);
    const delay = baseDelay + jitter;
    console.log(`[RETRY] Reconnecting in ${(delay/1000).toFixed(1)}s... (attempt ${this.retryCount}/${this.MAX_RETRIES})`);
    setTimeout(() => this.startWorker(), delay);
  }

  private async setupConsumer(channel: amqp.Channel, dlqName: string, dlqEnabled: boolean): Promise<void> {
    // ============================================
    // Concurrency Configuration for K8s
    // ============================================
    const concurrentJobs = parseInt(
      this.configService.get<string>('WORKER_CONCURRENCY') || '1',  // Default = 1 cho K8s
      10
    );
    channel.prefetch(concurrentJobs);
    
    // Log warning concurrency > 2 production
    if (process.env.NODE_ENV === 'production' && concurrentJobs > 2) {
      console.warn(`[WARN] WARNING: WORKER_CONCURRENCY=${concurrentJobs} may cause performance issues on K8s`);
      console.warn(`   Recommend: Set WORKER_CONCURRENCY=1 and scale with more Pods instead`);
    }
    
    console.log(`[OK] Worker Configuration:`);
    console.log(`   Concurrent Jobs: ${concurrentJobs} (Recommend: 1-2 for K8s)`);
    console.log(`   Queue: ${this.queueName}`);
    console.log(`   Dead Letter Queue: ${dlqEnabled ? dlqName : 'DISABLED (delete queue to enable)'}`);
    console.log(`   Ready to process videos!`);

    // [OK] Sequential processing pattern (better for CPU-bound FFmpeg tasks)
    channel.consume(this.queueName, async (msg) => {
      if (msg !== null) {
        // Track current job for graceful shutdown
        this.currentJobCount++;
        
        const job = JSON.parse(msg.content.toString());
        const startTime = Date.now();
        console.log(`[+] Received job: ${job.videoId}`);

        try {
          await this.processVideo(job);
          // ============================================
          // SAFE ACK: Handle channel closed gracefully
          // ============================================
          // RabbitMQ may close the channel if consumer_timeout is exceeded
          // (e.g., video processing took >30min with default timeout).
          // We must catch this to prevent crashing the entire worker.
          // The video is already processed and saved to DB at this point,
          // so the ack failure only means RabbitMQ will redeliver the message
          // (but DB status=ready so it will be skipped or re-processed harmlessly).
          // ============================================
          try {
            channel.ack(msg);
          } catch (ackError) {
            console.warn(`[WARN] Could not ack job ${job.videoId}: ${ackError.message}`);
            console.warn(`   Video was processed successfully but RabbitMQ channel closed.`);
            console.warn(`   This is likely due to consumer_timeout. Increase RABBITMQ consumer_timeout.`);
          }
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(`[✓] Job ${job.videoId} completed in ${duration}s`);
        } catch (error) {
          console.error(`[-] Failed to process job ${job.videoId}:`, error.message);
          
          // ============================================
          // SAFE NACK/ACK: Handle channel closed gracefully
          // ============================================
          try {
            if (dlqEnabled) {
              channel.nack(msg, false, false);
              console.log(`[!] Job ${job.videoId} moved to Dead Letter Queue for manual review`);
            } else {
              channel.ack(msg);
              console.error(`[!] Job ${job.videoId} FAILED and DISCARDED (no DLQ configured)`);
              console.error(`    [WARN] WARNING: Video lost! Enable DLQ to prevent data loss.`);
            }
          } catch (nackError) {
            console.warn(`[WARN] Could not ack/nack job ${job.videoId}: ${nackError.message}`);
            console.warn(`   Channel likely closed due to consumer_timeout.`);
          }
            
          // Update DB status = FAILED
          try {
            await this.videoRepository.update(job.videoId, {
              status: VideoStatus.FAILED,
              errorMessage: `Processing failed: ${error.message}`,
            });
          } catch (dbError) {
            console.error(`    Could not update DB:`, dbError.message);
          }
        } finally {
          this.currentJobCount--;
          this.totalJobsProcessed++;
          this.lastJobCompletedAt = Date.now();
          
          // Log batch progress
          if (this.isBatchMode) {
            console.log(`[BATCH] Jobs processed so far: ${this.totalJobsProcessed}`);
          }
        }
      }
    }, { consumerTag: 'video-worker-consumer' });
  }

  private async processVideo(job: any): Promise<void> {
    const { videoId, filePath, fileName, skipThumbnailGeneration, thumbnailTimestamp } = job;

    // ============================================
    // ??? DECLARE PATHS OUTSIDE TRY FOR CLEANUP ACCESS
    // ============================================
    // These variables need to be accessible in catch block
    // for proper cleanup when processing fails
    // ============================================
    let inputPath: string = '';
    let outputDir: string = '';

    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`[VIDEO] PROCESSING VIDEO: ${videoId}`);
      console.log(`${'='.repeat(60)}`);
      
      // 1. lấy thông tin từ database
      const video = await this.videoRepository.findOne({ where: { id: videoId } });
      if (!video) {
        throw new Error(`Video ${videoId} not found in database`);
      }

      console.log(`[OK] Video found in database`);
      console.log(`   Title: ${video.title}`);
      console.log(`   User: ${video.userId}`);

      // ============================================
      //  DOCKER/K8S COMPATIBLE PATH RESOLUTION
      // ============================================
      // In Docker: Both services mount shared volume at /app/uploads
      // Set UPLOAD_ROOT_PATH=/app/uploads in docker-compose
      // Locally: Falls back to ../video-service (dev environment)
      // ============================================
      const uploadRoot = this.configService.get<string>('UPLOAD_ROOT_PATH') 
        || path.resolve(process.cwd(), '..', 'video-service');
      inputPath = path.join(uploadRoot, filePath);
      const outputFileName = path.parse(fileName).name;
      outputDir = path.join(this.processedDir, outputFileName);

      // Check if input file exists
      if (!fs.existsSync(inputPath)) {
        // ============================================
        // [S3 FALLBACK] Download from S3 if local file not found
        // ============================================
        // This happens when running as AWS Batch worker on a
        // separate machine that doesn't have the local file.
        // video-service syncs raw videos to S3 on upload.
        // ============================================
        console.log(`[S3-FALLBACK] Local file not found, attempting S3 download...`);
        await this.ensureInputFileExists(inputPath, fileName);
      }

      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found (local and S3): ${inputPath}`);
      }

      const stats = fs.statSync(inputPath);
      console.log(`[OK] Input file found: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      // ============================================
      // ??? VALIDATION: Check Video Duration
      // ============================================
      // Short video platforms typically limit video length:
      // - TikTok: up to 10 minutes (was 3 min, expanded in 2022)
      // - Instagram Reels: up to 90 seconds (feed) / 15 min (upload)
      // - YouTube Shorts: up to 60 seconds
      // We allow 10 minutes to match TikTok's current limit
      // ============================================
      const MAX_VIDEO_DURATION_SECONDS = 600; // 10 minutes max (like TikTok)
      
      console.log(`[TIME] Checking video duration...`);
      const videoDuration = await this.getVideoDuration(inputPath);
      console.log(`   Duration: ${videoDuration.toFixed(1)} seconds`);
      
      if (videoDuration > MAX_VIDEO_DURATION_SECONDS) {
        throw new Error(
          `Video too long (${videoDuration.toFixed(0)}s). ` +
          `Maximum allowed duration for short videos is ${MAX_VIDEO_DURATION_SECONDS}s (${MAX_VIDEO_DURATION_SECONDS / 60} minutes). ` +
          `Please trim your video and try again.`
        );
      }

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      console.log(`[PATH] Input: ${inputPath}`);
      console.log(`[PATH] Output: ${outputDir}`);

      // 3. Get original video aspect ratio using ffprobe
      console.log(`[DETECT] Detecting video aspect ratio...`);
      const originalAspectRatio = await this.getVideoAspectRatio(inputPath);
      console.log(`[OK] Aspect ratio: ${originalAspectRatio}`);

      // ============================================
      // 4. FFmpeg + AI Analysis (RUN IN PARALLEL)
      // ============================================
      // AI analysis (~3-5s) runs concurrently with FFmpeg (~30-120s)
      // so it adds ZERO extra delay to the processing pipeline
      // ============================================
      console.log(`[FFMPEG] Starting FFmpeg conversion + AI analysis in parallel...`);
      
      const ffmpegPromise = this.convertToHLS(inputPath, outputDir, videoId, originalAspectRatio);
      const aiPromise = this.aiAnalysisService.analyzeVideo(
        inputPath,
        video.title,
        video.description || '',
        videoDuration,
      ).catch(err => {
        console.warn(`[AI] AI analysis failed (non-critical): ${err.message}`);
        return null;
      });

      // Wait for both to complete
      const [, aiResult] = await Promise.all([ffmpegPromise, aiPromise]);

      // 5. Tạo thumbnail từ video (skip if custom thumbnail already provided)
      if (skipThumbnailGeneration && video.thumbnailUrl) {
        console.log(`[THUMB] Skipping thumbnail generation - custom thumbnail already provided`);
        console.log(`   Existing thumbnail: ${video.thumbnailUrl}`);
      } else {
        console.log(`[THUMB] Generating thumbnail...`);
        await this.generateThumbnail(inputPath, outputDir, thumbnailTimestamp);
      }

      // 6. Upload to S3 or use local paths
      let hlsUrl: string;
      let thumbnailUrl: string | null;

      if (this.storageService.isEnabled()) {
        // Upload to AWS S3 (with parallel upload for performance)
        console.log(`[S3] Uploading to S3 (parallel mode)...`);
        const uploadResult = await this.storageService.uploadProcessedVideo(outputDir, videoId);
        hlsUrl = uploadResult.hlsUrl;
        // Keep custom thumbnail if provided, otherwise use generated one
        thumbnailUrl = (skipThumbnailGeneration && video.thumbnailUrl) 
          ? video.thumbnailUrl 
          : uploadResult.thumbnailUrl;

        // Clean up local processed files after S3 upload
        console.log(`[CLEANUP] Cleaning up local processed files...`);
        fs.rmSync(outputDir, { recursive: true, force: true });
      } else {
        // Use local paths - ABR uses master.m3u8 as entry point
        hlsUrl = `/uploads/processed_videos/${outputFileName}/master.m3u8`;
        // Keep custom thumbnail if provided, otherwise use generated one
        thumbnailUrl = (skipThumbnailGeneration && video.thumbnailUrl) 
          ? video.thumbnailUrl 
          : `/uploads/processed_videos/${outputFileName}/thumbnail.jpg`;
      }

      // 7. Delete raw video file to save storage (best practice for video platforms)
      // Raw videos are no longer needed after HLS conversion is complete
      console.log(`[DELETE] Deleting raw video file to save storage...`);
      try {
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
          console.log(`[OK] Raw video deleted (local): ${inputPath}`);
        }
      } catch (deleteError) {
        // Log but don't fail - raw video deletion is not critical
        console.warn(`[WARN] Could not delete raw video (local): ${deleteError.message}`);
      }

      // ============================================
      // [S3 CLEANUP] Delete raw video from S3 after processing
      // ============================================
      // Raw video was synced to S3 by video-service for Batch workers.
      // Now that processing is complete, delete it to save S3 costs.
      // ============================================
      try {
        const rawS3Key = `raw_videos/${fileName}`;
        console.log(`[S3-CLEANUP] Deleting raw video from S3: ${rawS3Key}`);
        await this.storageService.deleteFile(rawS3Key);
      } catch (s3DeleteError) {
        console.warn(`[WARN] Could not delete raw video from S3: ${s3DeleteError.message}`);
      }

      // 8. Cập nhật database với aspect ratio và thumbnail
      await this.videoRepository.update(videoId, {
        status: VideoStatus.READY,
        hlsUrl: hlsUrl,
        thumbnailUrl: thumbnailUrl,
        aspectRatio: originalAspectRatio,
      });

      // ============================================
      // 8.5 [AI] Assign AI-predicted categories via video-service API
      // ============================================
      // This is a non-critical step - if it fails, the video is still READY
      // with user-selected categories. AI categories are bonus.
      // ============================================
      if (aiResult && aiResult.categoryIds.length > 0) {
        await this.assignAiCategories(videoId, aiResult.categoryIds);
      }

      // 9. Notify video-service to invalidate cache
      await this.notifyProcessingComplete(videoId, video.userId);

      console.log(`\n${'='.repeat(60)}`);
      console.log(`[OK] VIDEO PROCESSING COMPLETED: ${videoId}`);
      console.log(`   HLS URL: ${hlsUrl}`);
      console.log(`   Thumbnail URL: ${thumbnailUrl}`);
      console.log(`   Custom Thumbnail: ${skipThumbnailGeneration ? 'Yes' : 'No'}`);
      console.log(`   Aspect Ratio: ${originalAspectRatio}`);
      console.log(`${'='.repeat(60)}\n`);
    } catch (error) {
      console.error(`\n${'='.repeat(60)}`);
      console.error(`[ERROR] ERROR PROCESSING VIDEO: ${videoId}`);
      console.error(`${'='.repeat(60)}`);
      console.error(`Error details:`, error);
      console.error(`Stack trace:`, error.stack);
      console.error(`${'='.repeat(60)}\n`);

      // ============================================
      // [CLEANUP] CLEANUP ON FAILURE - Prevent Disk Full
      // ============================================
      // When processing fails, clean up ONLY partial outputs.
      // KEEP the raw video file so retry is possible.
      // 1. Raw video file (inputPath) - KEEP for retry!
      // 2. Partial output directory (outputDir) - DELETE (incomplete HLS files)
      // ============================================
      try {
        if (outputDir && fs.existsSync(outputDir)) {
          console.log(`[CLEANUP] Cleanup: Removing incomplete output directory...`);
          fs.rmSync(outputDir, { recursive: true, force: true });
          console.log(`   [OK] Deleted output dir: ${outputDir}`);
        }
        if (inputPath && fs.existsSync(inputPath)) {
          console.log(`[CLEANUP] Raw video file KEPT for retry: ${inputPath}`);
        }
      } catch (cleanupError) {
        // Log but don't throw - cleanup failure shouldn't mask original error
        console.error(`[WARN] Cleanup failed (manual intervention may be needed):`, cleanupError.message);
      }

      // Cập nhật status thành FAILED
      await this.videoRepository.update(videoId, {
        status: VideoStatus.FAILED,
        errorMessage: error.message || 'Unknown error',
      });
    }
  }

  // ============================================
  // [S3 FALLBACK] Ensure input file exists
  // ============================================
  // If the raw video file is not found locally (AWS Batch worker),
  // download it from S3 where video-service synced it on upload.
  //
  // Flow:
  // 1. User uploads video → multer saves to EC2 disk
  // 2. video-service syncs raw file to S3 (raw_videos/{filename})
  // 3. RabbitMQ message sent → Batch worker picks it up
  // 4. Batch worker can't find local file → downloads from S3
  // 5. Processing continues as normal
  //
  // EC2 local worker: File exists locally → skip S3 download (fast!)
  // Batch worker: File not local → download from S3 → process
  // ============================================
  private async ensureInputFileExists(inputPath: string, fileName: string): Promise<void> {
    if (!this.storageService.isEnabled()) {
      console.warn(`[S3-FALLBACK] S3 not configured, cannot download raw video`);
      return;
    }

    const s3Key = `raw_videos/${fileName}`;
    console.log(`[S3-FALLBACK] Checking S3 for: ${s3Key}`);

    const exists = await this.storageService.fileExists(s3Key);
    if (!exists) {
      console.error(`[S3-FALLBACK] Raw video not found in S3 either: ${s3Key}`);
      return;
    }

    // Ensure parent directory exists
    const dir = path.dirname(inputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Download from S3 to local path
    await this.storageService.downloadFile(s3Key, inputPath);
    console.log(`[S3-FALLBACK] [OK] Downloaded raw video from S3 to: ${inputPath}`);
  }

  private getVideoAspectRatio(inputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        if (!videoStream || !videoStream.width || !videoStream.height) {
          resolve('unknown');
          return;
        }

        const width = videoStream.width;
        const height = videoStream.height;
        const ratio = width / height;

        // Detect common aspect ratios
        if (Math.abs(ratio - 9/16) < 0.01) {
          resolve('9:16'); // Portrait (TikTok)
        } else if (Math.abs(ratio - 16/9) < 0.01) {
          resolve('16:9'); // Landscape (YouTube)
        } else if (Math.abs(ratio - 1) < 0.01) {
          resolve('1:1'); // Square (Instagram)
        } else if (Math.abs(ratio - 4/3) < 0.01) {
          resolve('4:3'); // Classic TV
        } else {
          resolve(`${width}:${height}`); // Custom ratio
        }
      });
    });
  }

  /**
   * ============================================
   * [TIME] GET VIDEO DURATION
   * ============================================
   * Use ffprobe to get video duration in seconds
   * Used for validation (reject videos > MAX_DURATION)
   * ============================================
   */
  private getVideoDuration(inputPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const duration = metadata.format?.duration || 0;
        resolve(duration);
      });
    });
  }

  // ============================================
  // ADAPTIVE BITRATE STREAMING (ABR)
  // ============================================
  // Variants được tạo:
  // - 720p (HD)   : Mạng tốt, WiFi
  // - 480p (SD)   : Mạng trung bình, 4G
  // - 360p (Low)  : Mạng yếu, 3G
  // ============================================
  private async convertToHLS(inputPath: string, outputDir: string, videoId?: string, originalAspectRatio: string = '16:9'): Promise<void> {
    console.log(`[VIDEO] [ABR] Starting Adaptive Bitrate encoding...`);
    console.log(`   Original aspect ratio: ${originalAspectRatio}`);
    
    // Define quality variants for ABR
    // Bitrate recommendations from Apple HLS Authoring Specification
    const variants = [
      { name: '720p', height: 720, bitrate: '2500k', audioBitrate: '128k' },
      { name: '480p', height: 480, bitrate: '1200k', audioBitrate: '96k' },
      { name: '360p', height: 360, bitrate: '600k', audioBitrate: '64k' },
    ];

    // Process each variant sequentially to avoid memory issues
    for (const variant of variants) {
      console.log(`?? [ABR] Encoding ${variant.name} variant...`);
      await this.encodeVariant(inputPath, outputDir, variant, videoId);
    }

    // Generate master playlist that references all variants
    console.log(`[ABR] [ABR] Generating master playlist...`);
    await this.generateMasterPlaylist(outputDir, variants, originalAspectRatio);
    
    console.log(`[OK] [ABR] Adaptive Bitrate encoding completed!`);
    console.log(`   Variants: ${variants.map(v => v.name).join(', ')}`);
  }

  private encodeVariant(
    inputPath: string, 
    outputDir: string, 
    variant: { name: string; height: number; bitrate: string; audioBitrate: string },
    videoId?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const variantDir = path.join(outputDir, variant.name);
      
      // Create variant subdirectory
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }

      const command = ffmpeg(inputPath)
        .outputOptions([
          // Video codec
          '-c:v libx264',
          '-c:a aac',
          
          // ============================================
          // Performance Settings for K8s/Cloud
          // ============================================
          '-preset fast',        // Fast encoding, good for cloud costs
          '-profile:v main',     // Broad device compatibility
          '-level 3.1',          // Mobile device compatibility
          
          // Bitrate control
          `-b:v ${variant.bitrate}`,
          `-maxrate ${variant.bitrate}`,
          `-bufsize ${parseInt(variant.bitrate) * 2}k`,
          `-b:a ${variant.audioBitrate}`,
          '-ar 44100',
          
          // Scale to target height, maintain aspect ratio
          // -2 ensures width is divisible by 2 (required by h264)
          `-vf scale=-2:${variant.height}`,
          
          // Keyframe settings for smooth ABR switching
          '-g 48',               // GOP size = 2 seconds at 24fps
          '-keyint_min 48',
          '-sc_threshold 0',     // Disable scene change detection for consistent segments
          
          // Memory optimization for K8s
          '-max_muxing_queue_size 1024',
          
          // HLS Settings
          '-hls_time 6',                      // 6 second segments (Apple recommended)
          '-hls_playlist_type vod',
          '-hls_flags independent_segments',  // Each segment can be decoded independently
          '-hls_segment_type mpegts',
          `-hls_segment_filename ${variantDir}/segment%03d.ts`,
        ])
        .output(`${variantDir}/playlist.m3u8`)
        .on('start', (commandLine) => {
          console.log(`[FFmpeg ${variant.name}] Starting...`);
          // Track process for graceful shutdown
          if (videoId) {
            this.activeFFmpegProcesses.set(`${videoId}_${variant.name}`, command);
          }
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`[FFmpeg ${variant.name}] ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => {
          console.log(`[FFmpeg ${variant.name}] [OK] Completed`);
          if (videoId) {
            this.activeFFmpegProcesses.delete(`${videoId}_${variant.name}`);
          }
          resolve();
        })
        .on('error', (err) => {
          console.error(`[FFmpeg ${variant.name}] [ERROR] Error:`, err.message);
          if (videoId) {
            this.activeFFmpegProcesses.delete(`${videoId}_${variant.name}`);
          }
          reject(err);
        })
        .run();
    });
  }

  // ============================================
  // Generate HLS Master Playlist (master.m3u8)
  // ============================================
  // This file tells the player about available quality options
  // Player uses BANDWIDTH to automatically select best quality
  // ============================================
  private generateMasterPlaylist(
    outputDir: string,
    variants: { name: string; height: number; bitrate: string; audioBitrate: string }[],
    originalAspectRatio: string = '16:9'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        let masterContent = '#EXTM3U\n';
        masterContent += '#EXT-X-VERSION:3\n';
        masterContent += '\n';

        // ============================================
        // [VIDEO] DYNAMIC RESOLUTION CALCULATION
        // ============================================
        // Parse aspect ratio to calculate correct width for each variant
        // This ensures portrait (9:16), landscape (16:9), and square (1:1) videos
        // all have correct resolution metadata in the HLS manifest
        // ============================================
        let aspectRatio = 16 / 9; // Default landscape
        if (originalAspectRatio && originalAspectRatio.includes(':')) {
          const [w, h] = originalAspectRatio.split(':').map(Number);
          if (w > 0 && h > 0) {
            aspectRatio = w / h;
          }
        }
        console.log(`   Calculated aspect ratio: ${aspectRatio.toFixed(3)} (from ${originalAspectRatio})`);

        for (const variant of variants) {
          // Calculate total bandwidth (video + audio) in bits per second
          const videoBitrate = parseInt(variant.bitrate) * 1000;
          const audioBitrate = parseInt(variant.audioBitrate) * 1000;
          const totalBandwidth = videoBitrate + audioBitrate;
          
          // Calculate width based on ACTUAL aspect ratio
          // For portrait (9:16): height=720, ratio=0.5625 ? width=405
          // For landscape (16:9): height=720, ratio=1.778 ? width=1280
          // Ensure width is even (required by H.264)
          let width = Math.round(variant.height * aspectRatio);
          if (width % 2 !== 0) width++; // Make even
          
          masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${totalBandwidth},RESOLUTION=${width}x${variant.height},NAME="${variant.name}"\n`;
          masterContent += `${variant.name}/playlist.m3u8\n`;
        }

        const masterPath = path.join(outputDir, 'master.m3u8');
        fs.writeFileSync(masterPath, masterContent);
        
        console.log(`[OK] [ABR] Master playlist created: ${masterPath}`);
        console.log(`   Content:\n${masterContent}`);
        
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  private generateThumbnail(inputPath: string, outputDir: string, thumbnailTimestamp?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const thumbnailPath = `${outputDir}/thumbnail.jpg`;
      
      // Convert timestamp (seconds) to HH:MM:SS format for FFmpeg
      const seekTime = thumbnailTimestamp != null && thumbnailTimestamp > 0
        ? this.formatSeekTime(thumbnailTimestamp)
        : '00:00:01';
      
      console.log(`[THUMB] Generating thumbnail at: ${thumbnailPath} (seek: ${seekTime})`);
      
      // Use FFmpeg to create thumbnail with proper aspect ratio
      ffmpeg(inputPath)
        .outputOptions([
          // Seek to selected frame position
          '-ss', seekTime,
          // Take 1 frame
          '-vframes', '1',
          // Smart crop to 1:1 square for grid view (like Instagram/TikTok)
          // This crops the center and scales to 720x720
          '-vf', 'scale=720:720:force_original_aspect_ratio=increase,crop=720:720',
          // Quality
          '-q:v', '2',
        ])
        .output(thumbnailPath)
        .on('start', (commandLine) => {
          console.log('[FFmpeg Thumbnail] Command:', commandLine);
        })
        .on('end', () => {
          // Verify file was created
          if (fs.existsSync(thumbnailPath)) {
            const stats = fs.statSync(thumbnailPath);
            console.log(`[OK] Thumbnail generated successfully: ${(stats.size / 1024).toFixed(2)} KB`);
            resolve(thumbnailPath);
          } else {
            console.error('[ERROR] Thumbnail file not created');
            resolve('');
          }
        })
        .on('error', (err) => {
          console.error('[FFmpeg] Thumbnail generation error:', err);
          // Don't reject - video can still work without thumbnail
          resolve('');
        })
        .run();
    });
  }

  // Convert seconds to HH:MM:SS.ms format for FFmpeg -ss flag
  private formatSeekTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  }

  // Notify video-service to invalidate cache after processing
  private async notifyProcessingComplete(videoId: string, userId: string): Promise<void> {
    try {
      console.log(`[RETRY] Notifying video-service to invalidate cache for video ${videoId}...`);
      
      await firstValueFrom(
        this.httpService.post(
          `${this.videoServiceUrl}/videos/${videoId}/processing-complete`,
          { userId },
          { timeout: 5000 }
        )
      );
      
      console.log(`[OK] Video-service cache invalidated for video ${videoId}`);
    } catch (error) {
      // Log error but don't fail the processing - cache will eventually expire
      console.error(`[WARN] Failed to notify video-service for cache invalidation:`, error.message);
    }
  }

  // ============================================
  // [AI] Assign AI-predicted categories via video-service API
  // ============================================
  // Calls POST /categories/video/:videoId/ai-assign
  // This endpoint does union merge (adds AI categories without removing user-selected ones)
  // Non-critical: if this fails, the video still works with user-selected categories
  // ============================================
  private async assignAiCategories(videoId: string, categoryIds: number[]): Promise<void> {
    try {
      console.log(`[AI] Assigning AI categories to video ${videoId}: [${categoryIds.join(', ')}]`);
      
      await firstValueFrom(
        this.httpService.post(
          `${this.videoServiceUrl}/categories/video/${videoId}/ai-assign`,
          { categoryIds },
          { timeout: 10000 }
        )
      );
      
      console.log(`[AI] [OK] AI categories assigned successfully`);
    } catch (error) {
      // Non-critical - video still works without AI categories
      console.warn(`[AI] Failed to assign AI categories: ${error.message}`);
    }
  }
}

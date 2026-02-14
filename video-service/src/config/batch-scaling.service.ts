// ============================================
// AWS BATCH AUTO-SCALING SERVICE
// ============================================
// This service monitors the RabbitMQ queue and automatically
// submits AWS Batch jobs to scale video processing workers.
//
// HOW IT WORKS:
// 1. Periodically checks RabbitMQ queue depth (every 30 seconds)
// 2. If messages in queue > threshold → Submit AWS Batch job
// 3. AWS Batch automatically provisions EC2 instances (Spot = cheap)
// 4. Each Batch job runs the video-worker Docker container
// 5. Worker consumes messages from RabbitMQ and processes videos
// 6. When queue is empty → Batch job finishes → EC2 terminates
//
// COST OPTIMIZATION:
// - Uses EC2 Spot Instances (up to 90% cheaper than On-Demand)
// - Workers auto-terminate when no work available
// - No idle resources = no wasted money
//
// ARCHITECTURE:
//   Upload → RabbitMQ Queue ← Monitor (this service)
//                ↓                    ↓
//          Existing Worker    AWS Batch (auto-scale)
//          (always running)   (on-demand workers)
// ============================================

import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BatchClient,
  SubmitJobCommand,
  DescribeJobsCommand,
  ListJobsCommand,
  JobStatus,
} from '@aws-sdk/client-batch';
import * as amqp from 'amqplib';

// ============================================
// SCALING METRICS - Exposed for monitoring/health checks
// ============================================
export interface ScalingMetrics {
  queueDepth: number;
  activeWorkers: number;
  batchJobsRunning: number;
  batchJobsPending: number;
  lastScaleAction: string;
  lastCheckedAt: Date;
  totalJobsSubmitted: number;
  isEnabled: boolean;
}

@Injectable()
export class BatchScalingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BatchScalingService.name);

  // AWS Batch client
  private batchClient: BatchClient | null = null;
  private isEnabled = false;

  // RabbitMQ config
  private rabbitMQUrl: string;
  private queueName: string;

  // AWS Batch config
  private jobQueueArn: string;
  private jobDefinitionArn: string;

  // ============================================
  // SCALING PARAMETERS
  // ============================================
  // LOCAL WORKER: prefetch=1 (processes 1 video at a time on EC2 t3.large)
  // BATCH WORKER: prefetch=2 (runs on stronger Batch instances)
  //
  // THRESHOLD=2: When queue has >=2 ready messages, it means >=1 video
  // is waiting beyond local worker's capacity → dispatch to Batch immediately.
  // This ensures no video sits idle while the local worker is busy.
  // ============================================
  private readonly QUEUE_THRESHOLD = 2;          // Start scaling when queue has >= N ready messages
  private readonly LOCAL_WORKER_CONCURRENCY = 1; // EC2 local worker prefetch (must match docker-compose)
  private readonly BATCH_WORKER_CONCURRENCY = 2; // Batch worker prefetch (separate instance, more resources)
  private readonly MAX_BATCH_WORKERS = 10;       // Maximum concurrent Batch workers
  private readonly COOLDOWN_SECONDS = 120;       // Wait N seconds between scale actions
  private readonly WORKER_TIMEOUT_MINUTES = 30;  // Kill worker if running > N minutes

  // Scaling state
  private lastScaleTime = 0;
  private totalJobsSubmitted = 0;
  private metrics: ScalingMetrics = {
    queueDepth: 0,
    activeWorkers: 0,
    batchJobsRunning: 0,
    batchJobsPending: 0,
    lastScaleAction: 'none',
    lastCheckedAt: new Date(),
    totalJobsSubmitted: 0,
    isEnabled: false,
  };

  constructor(private configService: ConfigService) {
    this.rabbitMQUrl = this.configService.get<string>('RABBITMQ_URL') || 'amqp://admin:password@localhost:5672';
    this.queueName = this.configService.get<string>('RABBITMQ_QUEUE') || 'video_processing_queue';
    this.jobQueueArn = this.configService.get<string>('AWS_BATCH_JOB_QUEUE') || '';
    this.jobDefinitionArn = this.configService.get<string>('AWS_BATCH_JOB_DEFINITION') || '';
  }

  async onModuleInit() {
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const region = this.configService.get<string>('AWS_REGION') || 'ap-southeast-1';

    // Only enable if AWS Batch is configured
    if (accessKeyId && secretAccessKey && this.jobQueueArn && this.jobDefinitionArn) {
      this.batchClient = new BatchClient({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.isEnabled = true;
      this.metrics.isEnabled = true;

      this.logger.log('============================================');
      this.logger.log('  AWS BATCH AUTO-SCALING ENABLED');
      this.logger.log('============================================');
      this.logger.log(`  Job Queue:      ${this.jobQueueArn}`);
      this.logger.log(`  Job Definition: ${this.jobDefinitionArn}`);
      this.logger.log(`  Queue Threshold: ${this.QUEUE_THRESHOLD} messages`);
      this.logger.log(`  Local Worker:    prefetch=${this.LOCAL_WORKER_CONCURRENCY}`);
      this.logger.log(`  Batch Worker:    prefetch=${this.BATCH_WORKER_CONCURRENCY}`);
      this.logger.log(`  Max Workers:     ${this.MAX_BATCH_WORKERS}`);
      this.logger.log(`  Cooldown:        ${this.COOLDOWN_SECONDS}s`);
      this.logger.log(`  RabbitMQ:        ${this.rabbitMQUrl.replace(/\/\/.*:.*@/, '//*****:*****@')}`);
      this.logger.log(`  Cron Schedule:   Every 30 seconds`);
      this.logger.log('============================================');
    } else {
      this.logger.warn('============================================');
      this.logger.warn('  AWS BATCH AUTO-SCALING DISABLED');
      this.logger.warn('============================================');
      this.logger.warn('  Missing configuration:');
      if (!this.jobQueueArn) this.logger.warn('    - AWS_BATCH_JOB_QUEUE');
      if (!this.jobDefinitionArn) this.logger.warn('    - AWS_BATCH_JOB_DEFINITION');
      if (!accessKeyId) this.logger.warn('    - AWS_ACCESS_KEY_ID');
      this.logger.warn('  Video processing will use existing workers only.');
      this.logger.warn('  To enable: Set environment variables and restart.');
      this.logger.warn('============================================');
    }
  }

  async onModuleDestroy() {
    this.batchClient?.destroy();
  }

  // ============================================
  // CRON: Check queue every 30 seconds
  // ============================================
  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkQueueAndScale(): Promise<void> {
    if (!this.isEnabled) return;

    try {
      // 1. Get current queue depth + consumer count from RabbitMQ
      const { messageCount: queueDepth, consumerCount } = await this.getQueueDepth();
      
      // 2. Get current Batch job status
      const { running, pending } = await this.getBatchJobCounts();

      // 3. Update metrics
      this.metrics = {
        ...this.metrics,
        queueDepth,
        batchJobsRunning: running,
        batchJobsPending: pending,
        activeWorkers: running + pending,
        lastCheckedAt: new Date(),
      };

      this.logger.log(
        `[MONITOR] Queue: ${queueDepth} msgs, ${consumerCount} consumers | Batch: ${running} running, ${pending} pending`
      );

      // 4. Scaling decision
      // ============================================
      // SMART SCALING LOGIC (Consumer-Aware)
      // ============================================
      // When local worker is RUNNING (consumerCount > 0):
      //   Threshold = 2 (local handles 1, excess goes to Batch)
      //   excessMessages = queueDepth - LOCAL_WORKER_CONCURRENCY
      //
      // When local worker is STOPPED (consumerCount = 0):
      //   Threshold = 1 (NO local worker → Batch must handle ALL)
      //   excessMessages = queueDepth (everything needs Batch)
      //
      // This ensures Batch jobs are dispatched even for a single
      // video when the local worker is down.
      // ============================================
      const localWorkerActive = consumerCount > 0;
      const effectiveThreshold = localWorkerActive ? this.QUEUE_THRESHOLD : 1;
      const effectiveLocalCapacity = localWorkerActive ? this.LOCAL_WORKER_CONCURRENCY : 0;

      if (!localWorkerActive && queueDepth > 0) {
        this.logger.warn(`[MONITOR] No local consumers detected! Threshold lowered to 1`);
      }

      const now = Date.now();
      const cooldownElapsed = (now - this.lastScaleTime) / 1000 > this.COOLDOWN_SECONDS;

      if (queueDepth >= effectiveThreshold && cooldownElapsed) {
        // Subtract what local worker can handle (0 if stopped), then calculate Batch workers needed
        const excessMessages = Math.max(0, queueDepth - effectiveLocalCapacity);
        const totalWorkersNeeded = Math.ceil(excessMessages / this.BATCH_WORKER_CONCURRENCY);
        const currentWorkers = running + pending;
        const workersToAdd = Math.min(
          totalWorkersNeeded - currentWorkers,
          this.MAX_BATCH_WORKERS - currentWorkers,
        );

        if (workersToAdd > 0) {
          this.logger.log(
            `[SCALE-UP] Queue depth: ${queueDepth} → Launching ${workersToAdd} Batch worker(s)`
          );

          for (let i = 0; i < workersToAdd; i++) {
            await this.submitBatchJob(queueDepth);
          }

          this.lastScaleTime = now;
          this.metrics.lastScaleAction = `scale-up: +${workersToAdd} workers at ${new Date().toISOString()}`;
        }
      } else if (queueDepth === 0 && running === 0 && pending === 0) {
        this.metrics.lastScaleAction = `idle (no work) at ${new Date().toISOString()}`;
      }
    } catch (error) {
      this.logger.error(`[MONITOR] Error checking queue: ${error.message}`);
    }
  }

  // ============================================
  // GET RABBITMQ QUEUE DEPTH + CONSUMER COUNT
  // ============================================
  // Connects to RabbitMQ to check how many messages are
  // waiting and how many consumers are active.
  // Consumer count is critical: when local worker is stopped,
  // we need to lower the threshold to dispatch to Batch sooner.
  // ============================================
  private async getQueueDepth(): Promise<{ messageCount: number; consumerCount: number }> {
    let connection: amqp.Connection | null = null;
    let channel: amqp.Channel | null = null;

    try {
      connection = await amqp.connect(this.rabbitMQUrl);
      channel = await connection.createChannel();
      
      // checkQueue returns { queue, messageCount, consumerCount }
      const queueInfo = await channel.checkQueue(this.queueName);
      
      this.logger.log(`[QUEUE] Ready: ${queueInfo.messageCount}, Consumers: ${queueInfo.consumerCount}`);
      return {
        messageCount: queueInfo.messageCount,
        consumerCount: queueInfo.consumerCount,
      };
    } catch (error) {
      this.logger.error(`[QUEUE] Failed to check queue depth: ${error.message}`);
      this.logger.error(`[QUEUE] RabbitMQ URL: ${this.rabbitMQUrl.replace(/\/\/.*:.*@/, '//*****:*****@')}`);
      return { messageCount: 0, consumerCount: 0 };
    } finally {
      try {
        if (channel) await channel.close();
        if (connection) await connection.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ============================================
  // GET CURRENT BATCH JOB COUNTS
  // ============================================
  private async getBatchJobCounts(): Promise<{ running: number; pending: number }> {
    if (!this.batchClient) return { running: 0, pending: 0 };

    try {
      const [runningJobs, pendingJobs] = await Promise.all([
        this.batchClient.send(new ListJobsCommand({
          jobQueue: this.jobQueueArn,
          jobStatus: JobStatus.RUNNING,
        })),
        this.batchClient.send(new ListJobsCommand({
          jobQueue: this.jobQueueArn,
          jobStatus: JobStatus.RUNNABLE,
        })),
      ]);

      return {
        running: runningJobs.jobSummaryList?.length || 0,
        pending: pendingJobs.jobSummaryList?.length || 0,
      };
    } catch (error) {
      this.logger.error(`Failed to get Batch job counts: ${error.message}`);
      return { running: 0, pending: 0 };
    }
  }

  // ============================================
  // SUBMIT AWS BATCH JOB
  // ============================================
  // Each job runs the video-worker Docker container.
  // The container connects to RabbitMQ and processes messages
  // until the queue is empty, then exits gracefully.
  // ============================================
  private async submitBatchJob(currentQueueDepth: number): Promise<string | null> {
    if (!this.batchClient) return null;

    try {
      const jobName = `video-worker-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

      const result = await this.batchClient.send(new SubmitJobCommand({
        jobName,
        jobQueue: this.jobQueueArn,
        jobDefinition: this.jobDefinitionArn,
        
        // ============================================
        // ENVIRONMENT OVERRIDES
        // ============================================
        // Pass dynamic configuration to the worker container
        // These override the defaults in the Job Definition
        // ============================================
        containerOverrides: {
          environment: [
            { name: 'WORKER_CONCURRENCY', value: String(this.BATCH_WORKER_CONCURRENCY) },
            { name: 'BATCH_MODE', value: 'true' },
            // Auto-exit when queue is empty (Batch-specific behavior)
            { name: 'AUTO_EXIT_WHEN_IDLE', value: 'true' },
            { name: 'IDLE_TIMEOUT_SECONDS', value: '60' },
            // CRITICAL: CloudFront URL for generating correct video/thumbnail URLs
            // Without this, worker falls back to S3 direct URL which is private
            { name: 'CLOUDFRONT_URL', value: this.configService.get<string>('CLOUDFRONT_URL') || '' },
          ],
        },
        
        // ============================================
        // JOB TIMEOUT
        // ============================================
        // Kill the job if it runs longer than expected
        // Prevents zombie workers from running forever
        // ============================================
        timeout: {
          attemptDurationSeconds: this.WORKER_TIMEOUT_MINUTES * 60,
        },

        // Tags for cost tracking
        tags: {
          'project': 'short-video-app',
          'component': 'video-processing',
          'queue-depth': String(currentQueueDepth),
        },
      }));

      this.totalJobsSubmitted++;
      this.metrics.totalJobsSubmitted = this.totalJobsSubmitted;

      this.logger.log(
        `[BATCH] Submitted job: ${jobName} (ID: ${result.jobId})`
      );

      return result.jobId || null;
    } catch (error) {
      this.logger.error(`[BATCH] Failed to submit job: ${error.message}`);
      return null;
    }
  }

  // ============================================
  // MANUAL TRIGGER - For API endpoint
  // ============================================
  // Allows manual scaling via REST API
  // POST /scaling/trigger
  // ============================================
  async manualTriggerScale(workerCount: number = 1): Promise<{ jobIds: string[] }> {
    if (!this.isEnabled) {
      throw new Error('AWS Batch auto-scaling is not enabled');
    }

    const jobIds: string[] = [];
    const count = Math.min(workerCount, this.MAX_BATCH_WORKERS);

    for (let i = 0; i < count; i++) {
      const jobId = await this.submitBatchJob(0);
      if (jobId) jobIds.push(jobId);
    }

    this.logger.log(`[MANUAL] Triggered ${jobIds.length} Batch worker(s)`);
    return { jobIds };
  }

  // ============================================
  // GET METRICS - For monitoring/health endpoint
  // ============================================
  getMetrics(): ScalingMetrics {
    return { ...this.metrics };
  }

  // ============================================
  // GET DETAILED JOB STATUS
  // ============================================
  async getJobDetails(jobIds: string[]): Promise<any[]> {
    if (!this.batchClient || jobIds.length === 0) return [];

    try {
      const result = await this.batchClient.send(new DescribeJobsCommand({
        jobs: jobIds,
      }));

      return (result.jobs || []).map(job => ({
        jobId: job.jobId,
        jobName: job.jobName,
        status: job.status,
        statusReason: job.statusReason,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        stoppedAt: job.stoppedAt,
        container: {
          exitCode: job.container?.exitCode,
          reason: job.container?.reason,
          vcpus: job.container?.vcpus,
          memory: job.container?.memory,
        },
      }));
    } catch (error) {
      this.logger.error(`Failed to get job details: ${error.message}`);
      return [];
    }
  }
}

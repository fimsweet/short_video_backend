/* eslint-disable @typescript-eslint/no-unused-vars */
const mockBatchSend = jest.fn();
const mockBatchDestroy = jest.fn();

jest.mock('@aws-sdk/client-batch', () => ({
  BatchClient: jest.fn().mockImplementation(() => ({
    send: mockBatchSend,
    destroy: mockBatchDestroy,
  })),
  SubmitJobCommand: jest.fn().mockImplementation((params) => params),
  DescribeJobsCommand: jest.fn().mockImplementation((params) => params),
  ListJobsCommand: jest.fn().mockImplementation((params) => params),
  JobStatus: {
    SUBMITTED: 'SUBMITTED',
    PENDING: 'PENDING',
    RUNNABLE: 'RUNNABLE',
    STARTING: 'STARTING',
    RUNNING: 'RUNNING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
  },
}));

const mockConnect = jest.fn();
const mockCreateChannel = jest.fn();
const mockCheckQueue = jest.fn();
const mockChannelClose = jest.fn();
const mockConnectionClose = jest.fn();

jest.mock('amqplib', () => ({
  connect: mockConnect,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BatchScalingService } from './batch-scaling.service';

describe('BatchScalingService', () => {
  let service: BatchScalingService;
  let configService: any;

  const mockChannel = {
    checkQueue: mockCheckQueue,
    close: mockChannelClose,
  };

  const mockConnection = {
    createChannel: mockCreateChannel,
    close: mockConnectionClose,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    mockConnect.mockResolvedValue(mockConnection);
    mockCreateChannel.mockResolvedValue(mockChannel);
    mockCheckQueue.mockResolvedValue({ messageCount: 0, consumerCount: 1 });

    configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          RABBITMQ_URL: 'amqp://admin:password@localhost:5672',
          RABBITMQ_QUEUE: 'video_processing_queue',
          AWS_BATCH_JOB_QUEUE: 'arn:aws:batch:us-east-1:123456:job-queue/test',
          AWS_BATCH_JOB_DEFINITION: 'arn:aws:batch:us-east-1:123456:job-definition/test',
          AWS_ACCESS_KEY_ID: 'test-key',
          AWS_SECRET_ACCESS_KEY: 'test-secret',
          AWS_REGION: 'us-east-1',
          CLOUDFRONT_URL: 'https://cdn.example.com',
        };
        return config[key] || null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchScalingService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<BatchScalingService>(BatchScalingService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('onModuleInit', () => {
    it('should enable when AWS credentials are configured', async () => {
      await service.onModuleInit();
      expect(service.getMetrics().isEnabled).toBe(true);
    });

    it('should disable when AWS credentials are missing', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'AWS_ACCESS_KEY_ID') return null;
        if (key === 'RABBITMQ_URL') return 'amqp://localhost';
        return null;
      });

      const module = await Test.createTestingModule({
        providers: [
          BatchScalingService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();
      const svc = module.get<BatchScalingService>(BatchScalingService);

      await svc.onModuleInit();
      expect(svc.getMetrics().isEnabled).toBe(false);
    });

    it('should disable when job queue ARN is missing', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'AWS_BATCH_JOB_QUEUE') return '';
        if (key === 'AWS_ACCESS_KEY_ID') return 'key';
        if (key === 'AWS_SECRET_ACCESS_KEY') return 'secret';
        if (key === 'RABBITMQ_URL') return 'amqp://localhost';
        return null;
      });

      const module = await Test.createTestingModule({
        providers: [
          BatchScalingService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();
      const svc = module.get<BatchScalingService>(BatchScalingService);
      await svc.onModuleInit();
      expect(svc.getMetrics().isEnabled).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('should destroy batch client', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();
      expect(mockBatchDestroy).toHaveBeenCalled();
    });

    it('should handle no client (disabled mode)', async () => {
      // Don't init — no client to destroy
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe('checkQueueAndScale', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should do nothing when disabled', async () => {
      // Reset to disabled state
      configService.get.mockReturnValue(null);
      const module = await Test.createTestingModule({
        providers: [
          BatchScalingService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();
      const svc = module.get<BatchScalingService>(BatchScalingService);
      await svc.onModuleInit();

      await svc.checkQueueAndScale();
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('should report idle when queue is empty', async () => {
      mockCheckQueue.mockResolvedValue({ messageCount: 0, consumerCount: 1 });
      mockBatchSend.mockResolvedValue({ jobSummaryList: [] });

      await service.checkQueueAndScale();
      const metrics = service.getMetrics();
      expect(metrics.queueDepth).toBe(0);
    });

    it('should scale up when queue exceeds threshold', async () => {
      mockCheckQueue.mockResolvedValue({ messageCount: 5, consumerCount: 1 });
      mockBatchSend.mockImplementation((cmd: any) => {
        if (cmd.jobQueue && cmd.jobStatus) {
          return Promise.resolve({ jobSummaryList: [] }); // ListJobs
        }
        return Promise.resolve({ jobId: 'job-123' }); // SubmitJob
      });

      await service.checkQueueAndScale();
      const metrics = service.getMetrics();
      expect(metrics.totalJobsSubmitted).toBeGreaterThan(0);
    });

    it('should lower threshold when no local consumers', async () => {
      mockCheckQueue.mockResolvedValue({ messageCount: 1, consumerCount: 0 });
      mockBatchSend.mockImplementation((cmd: any) => {
        if (cmd.jobQueue && cmd.jobStatus) {
          return Promise.resolve({ jobSummaryList: [] });
        }
        return Promise.resolve({ jobId: 'job-456' });
      });

      await service.checkQueueAndScale();
      const metrics = service.getMetrics();
      expect(metrics.totalJobsSubmitted).toBeGreaterThan(0);
    });

    it('should respect cooldown period', async () => {
      mockCheckQueue.mockResolvedValue({ messageCount: 5, consumerCount: 1 });
      mockBatchSend.mockImplementation((cmd: any) => {
        if (cmd.jobQueue && cmd.jobStatus) {
          return Promise.resolve({ jobSummaryList: [] });
        }
        return Promise.resolve({ jobId: 'job-789' });
      });

      // First call — should scale
      await service.checkQueueAndScale();
      const afterFirst = service.getMetrics().totalJobsSubmitted;

      // Second call immediately — should be on cooldown
      await service.checkQueueAndScale();
      const afterSecond = service.getMetrics().totalJobsSubmitted;
      expect(afterSecond).toBe(afterFirst); // No new jobs due to cooldown
    });

    it('should handle RabbitMQ connection error', async () => {
      mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));
      await service.checkQueueAndScale();
      // Should not throw
      expect(service.getMetrics().queueDepth).toBe(0);
    });

    it('should handle Batch API error', async () => {
      mockCheckQueue.mockResolvedValue({ messageCount: 5, consumerCount: 1 });
      mockBatchSend.mockRejectedValue(new Error('AccessDenied'));
      await service.checkQueueAndScale();
      // Should not throw
    });

    it('should not exceed max workers', async () => {
      mockCheckQueue.mockResolvedValue({ messageCount: 100, consumerCount: 1 });
      mockBatchSend.mockImplementation((cmd: any) => {
        if (cmd.jobQueue && cmd.jobStatus) {
          return Promise.resolve({ jobSummaryList: [] });
        }
        return Promise.resolve({ jobId: `job-${Date.now()}` });
      });

      await service.checkQueueAndScale();
      expect(service.getMetrics().totalJobsSubmitted).toBeLessThanOrEqual(10);
    });
  });

  describe('manualTriggerScale', () => {
    it('should submit batch jobs', async () => {
      await service.onModuleInit();
      mockBatchSend.mockResolvedValue({ jobId: 'manual-job-1' });

      const result = await service.manualTriggerScale(2);
      expect(result.jobIds).toHaveLength(2);
    });

    it('should throw when not enabled', async () => {
      configService.get.mockReturnValue(null);
      const module = await Test.createTestingModule({
        providers: [
          BatchScalingService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();
      const svc = module.get<BatchScalingService>(BatchScalingService);
      await svc.onModuleInit();

      await expect(svc.manualTriggerScale()).rejects.toThrow('not enabled');
    });

    it('should cap workers at MAX_BATCH_WORKERS', async () => {
      await service.onModuleInit();
      mockBatchSend.mockResolvedValue({ jobId: 'job' });

      const result = await service.manualTriggerScale(100);
      expect(result.jobIds.length).toBeLessThanOrEqual(10);
    });

    it('should handle failed job submission', async () => {
      await service.onModuleInit();
      mockBatchSend.mockResolvedValue({ jobId: undefined });

      const result = await service.manualTriggerScale(1);
      expect(result.jobIds).toHaveLength(0);
    });
  });

  describe('getMetrics', () => {
    it('should return current metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics).toHaveProperty('queueDepth');
      expect(metrics).toHaveProperty('activeWorkers');
      expect(metrics).toHaveProperty('isEnabled');
      expect(metrics).toHaveProperty('totalJobsSubmitted');
    });

    it('should return a copy of metrics', () => {
      const m1 = service.getMetrics();
      const m2 = service.getMetrics();
      expect(m1).toEqual(m2);
      expect(m1).not.toBe(m2); // Different objects
    });
  });

  describe('getJobDetails', () => {
    it('should return job details', async () => {
      await service.onModuleInit();
      mockBatchSend.mockResolvedValue({
        jobs: [{
          jobId: 'j1',
          jobName: 'worker-1',
          status: 'RUNNING',
          statusReason: null,
          createdAt: new Date(),
          startedAt: new Date(),
          stoppedAt: null,
          container: { exitCode: null, reason: null, vcpus: 2, memory: 4096 },
        }],
      });

      const result = await service.getJobDetails(['j1']);
      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe('j1');
      expect(result[0].status).toBe('RUNNING');
    });

    it('should return empty for empty jobIds', async () => {
      await service.onModuleInit();
      const result = await service.getJobDetails([]);
      expect(result).toEqual([]);
    });

    it('should return empty when client not initialized', async () => {
      const result = await service.getJobDetails(['j1']);
      expect(result).toEqual([]);
    });

    it('should handle API error', async () => {
      await service.onModuleInit();
      mockBatchSend.mockRejectedValue(new Error('fail'));
      const result = await service.getJobDetails(['j1']);
      expect(result).toEqual([]);
    });
  });
});

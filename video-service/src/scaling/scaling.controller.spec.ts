import { Test, TestingModule } from '@nestjs/testing';
import { ScalingController } from './scaling.controller';
import { BatchScalingService } from '../config/batch-scaling.service';

describe('ScalingController', () => {
  let controller: ScalingController;
  let batchService: any;

  const mockMetrics = {
    queueDepth: 5,
    activeWorkers: 2,
    batchJobsRunning: 1,
    batchJobsPending: 1,
    lastScaleAction: 'scale-up',
    lastCheckedAt: new Date(),
    totalJobsSubmitted: 10,
    isEnabled: true,
  };

  beforeEach(async () => {
    batchService = {
      getMetrics: jest.fn().mockReturnValue(mockMetrics),
      manualTriggerScale: jest.fn().mockResolvedValue({ jobIds: ['j1'] }),
      checkQueueAndScale: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScalingController],
      providers: [{ provide: BatchScalingService, useValue: batchService }],
    }).compile();

    controller = module.get<ScalingController>(ScalingController);
  });

  it('should get metrics', () => {
    const result = controller.getMetrics();
    expect(result.queueDepth).toBe(5);
  });

  it('should get status', async () => {
    const result = await controller.getStatus();
    expect(result.success).toBe(true);
    expect(result.autoScaling.enabled).toBe(true);
  });

  it('should trigger scale', async () => {
    const result = await controller.triggerScale({ workerCount: 2 });
    expect(result.success).toBe(true);
    expect(batchService.manualTriggerScale).toHaveBeenCalledWith(2);
  });

  it('should trigger scale with default count', async () => {
    const result = await controller.triggerScale();
    expect(batchService.manualTriggerScale).toHaveBeenCalledWith(1);
  });

  it('should force check', async () => {
    const result = await controller.forceCheck();
    expect(result.success).toBe(true);
    expect(batchService.checkQueueAndScale).toHaveBeenCalled();
  });
});

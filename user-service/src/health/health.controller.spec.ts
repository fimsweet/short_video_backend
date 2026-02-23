import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService, TypeOrmHealthIndicator, MemoryHealthIndicator } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: any;

  beforeEach(async () => {
    healthService = {
      check: jest.fn().mockResolvedValue({
        status: 'ok',
        details: { database: { status: 'up' }, redis: { status: 'up' } },
      }),
    };

    const mockDb = { pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }) };
    const mockMemory = {
      checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
      checkRSS: jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } }),
    };
    const mockRedis = { pingCheck: jest.fn().mockResolvedValue({ redis: { status: 'up' } }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthService },
        { provide: TypeOrmHealthIndicator, useValue: mockDb },
        { provide: MemoryHealthIndicator, useValue: mockMemory },
        { provide: RedisHealthIndicator, useValue: mockRedis },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should return health check result', async () => {
      const result = await controller.check();
      expect(result.status).toBe('ok');
      expect(healthService.check).toHaveBeenCalled();
    });
  });

  describe('ready', () => {
    it('should return readiness check', async () => {
      const result = await controller.ready();
      expect(result.status).toBe('ok');
    });
  });

  describe('live', () => {
    it('should return liveness check', async () => {
      const result = await controller.live();
      expect(result.status).toBe('ok');
    });
  });
});

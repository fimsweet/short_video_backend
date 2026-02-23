import { HealthCheckError } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let mockCacheManager: any;

  beforeEach(() => {
    mockCacheManager = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
    };
    indicator = new RedisHealthIndicator(mockCacheManager);
  });

  it('should be defined', () => {
    expect(indicator).toBeDefined();
  });

  describe('pingCheck', () => {
    it('should return healthy when Redis responds correctly', async () => {
      mockCacheManager.get.mockImplementation(() => {
        return Promise.resolve(mockCacheManager.set.mock.calls[0]?.[1] || Date.now().toString());
      });
      // We need to make get return the same value that was set
      mockCacheManager.set.mockImplementation((key: string, value: string) => {
        mockCacheManager.get.mockResolvedValue(value);
        return Promise.resolve();
      });

      const result = await indicator.pingCheck('redis');
      expect(result.redis.status).toBe('up');
    });

    it('should throw HealthCheckError when Redis fails', async () => {
      mockCacheManager.set.mockRejectedValue(new Error('Connection refused'));

      await expect(indicator.pingCheck('redis')).rejects.toThrow(HealthCheckError);
    });

    it('should throw when Redis returns mismatched value', async () => {
      mockCacheManager.set.mockResolvedValue(undefined);
      mockCacheManager.get.mockResolvedValue('wrong-value');

      await expect(indicator.pingCheck('redis')).rejects.toThrow(HealthCheckError);
    });
  });
});

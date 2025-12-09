import { Injectable, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {
    super();
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      // Test Redis by setting and getting a test value
      const testKey = 'health_check_test';
      const testValue = Date.now().toString();
      
      await this.cacheManager.set(testKey, testValue, 1000);
      const result = await this.cacheManager.get(testKey);
      
      if (result === testValue) {
        return this.getStatus(key, true, { message: 'Redis is up and running' });
      }
      
      throw new Error('Redis test value mismatch');
    } catch (error) {
      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, { message: error.message }),
      );
    }
  }
}

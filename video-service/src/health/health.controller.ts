import { Controller, Get } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  @Get('redis')
  async checkRedis() {
    try {
      const testKey = 'health_check_test';
      const testValue = `Redis is working at ${new Date().toISOString()}`;
      
      // Test write
      await this.cacheManager.set(testKey, testValue, 10000); // 10 seconds TTL
      
      // Test read
      const cachedValue = await this.cacheManager.get(testKey);
      
      // Clean up
      await this.cacheManager.del(testKey);
      
      return {
        success: true,
        message: 'Redis is working correctly',
        test: {
          written: testValue,
          read: cachedValue,
          match: testValue === cachedValue,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        message: 'Redis connection failed',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('all')
  async checkAll() {
    const redisStatus = await this.checkRedis();
    
    return {
      services: {
        redis: redisStatus.success ? '✅ Running' : '❌ Down',
      },
      details: {
        redis: redisStatus,
      },
    };
  }
}

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

  /**
   * Basic health check - used by Docker/K8s
   */
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'video-service',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Liveness probe - K8s uses to check if pod is alive
   */
  @Get('live')
  liveness() {
    return { status: 'ok' };
  }

  /**
   * Readiness probe - K8s uses to check if pod can accept traffic
   */
  @Get('ready')
  async readiness() {
    const redisOk = await this.checkRedisHealth();
    if (!redisOk) {
      return { status: 'not ready', reason: 'Redis unavailable' };
    }
    return { status: 'ok' };
  }

  private async checkRedisHealth(): Promise<boolean> {
    try {
      const testKey = 'health_check_ping';
      await this.cacheManager.set(testKey, 'pong', 5000);
      const value = await this.cacheManager.get(testKey);
      return value === 'pong';
    } catch {
      return false;
    }
  }

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
      status: 'ok',
      service: 'video-service',
      timestamp: new Date().toISOString(),
      services: {
        redis: redisStatus.success ? '✅ Running' : '❌ Down',
      },
      details: {
        redis: redisStatus,
      },
    };
  }
}

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let mockCache: Record<string, jest.Mock>;

  beforeEach(() => {
    mockCache = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue('pong'),
      del: jest.fn().mockResolvedValue(undefined),
    };
    controller = new HealthController(mockCache as any);
  });

  describe('check', () => {
    it('should return service status', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('video-service');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('liveness', () => {
    it('should return ok', () => {
      expect(controller.liveness()).toEqual({ status: 'ok' });
    });
  });

  describe('readiness', () => {
    it('should return ok when Redis is healthy', async () => {
      const result = await controller.readiness();
      expect(result.status).toBe('ok');
    });

    it('should return not ready when Redis fails', async () => {
      mockCache.set.mockRejectedValue(new Error('conn'));
      const result = await controller.readiness();
      expect(result.status).toBe('not ready');
    });

    it('should return not ready when value mismatch', async () => {
      mockCache.get.mockResolvedValue('wrong');
      const result = await controller.readiness();
      expect(result.status).toBe('not ready');
    });
  });

  describe('checkRedis', () => {
    it('should return success when Redis works', async () => {
      mockCache.get.mockImplementation(async () => {
        const setCall = mockCache.set.mock.calls[0];
        return setCall ? setCall[1] : 'pong';
      });
      const result = await controller.checkRedis();
      expect(result.success).toBe(true);
      expect(result.test!.match).toBe(true);
    });

    it('should return failure on error', async () => {
      mockCache.set.mockRejectedValue(new Error('connection failed'));
      const result = await controller.checkRedis();
      expect(result.success).toBe(false);
      expect(result.error).toBe('connection failed');
    });
  });

  describe('checkAll', () => {
    it('should aggregate service status', async () => {
      mockCache.get.mockImplementation(async () => {
        const setCall = mockCache.set.mock.calls[0];
        return setCall ? setCall[1] : 'pong';
      });
      const result = await controller.checkAll();
      expect(result.status).toBe('ok');
      expect(result.services.redis).toContain('✅');
    });

    it('should show down when Redis fails', async () => {
      mockCache.set.mockRejectedValue(new Error('fail'));
      const result = await controller.checkAll();
      expect(result.services.redis).toContain('❌');
    });
  });
});

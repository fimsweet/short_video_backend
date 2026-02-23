import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  describe('check', () => {
    it('should return ok status with service name and timestamp', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('video-worker-service');
      expect(result.timestamp).toBeDefined();
    });

    it('should return ISO string timestamp', () => {
      const result = controller.check();
      expect(() => new Date(result.timestamp)).not.toThrow();
    });
  });

  describe('liveness', () => {
    it('should return ok status', () => {
      const result = controller.liveness();
      expect(result.status).toBe('ok');
    });
  });

  describe('readiness', () => {
    it('should return ok status', () => {
      const result = controller.readiness();
      expect(result.status).toBe('ok');
    });
  });
});

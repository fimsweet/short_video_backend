import { Test, TestingModule } from '@nestjs/testing';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

describe('SessionsController', () => {
  let controller: SessionsController;
  let service: jest.Mocked<Partial<SessionsService>>;

  const mockReq = { user: { id: 1 } };
  const authHeader = 'Bearer jwt-token-long-enough-for-test';

  beforeEach(async () => {
    service = {
      getUserSessions: jest.fn().mockResolvedValue([
        { id: 1, platform: 'android', deviceName: 'Pixel', isCurrent: true },
      ]),
      updateFcmToken: jest.fn().mockResolvedValue({ success: true }),
      clearFcmToken: jest.fn().mockResolvedValue({ success: true }),
      getLoginAlertsStatus: jest.fn().mockResolvedValue({ enabled: true, hasFcmToken: true }),
      toggleLoginAlerts: jest.fn().mockResolvedValue({ success: true }),
      logoutSession: jest.fn().mockResolvedValue({ success: true, message: 'OK' }),
      logoutAllOtherSessions: jest.fn().mockResolvedValue({ success: true, count: 2 }),
      logoutAllSessions: jest.fn().mockResolvedValue({ success: true, count: 3 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: SessionsService, useValue: service },
      ],
    }).compile();

    controller = module.get<SessionsController>(SessionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSessions', () => {
    it('should return user sessions', async () => {
      const result = await controller.getSessions(mockReq, authHeader);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('updateFcmToken', () => {
    it('should update FCM token', async () => {
      const result = await controller.updateFcmToken(mockReq, authHeader, { fcmToken: 'new-token' });
      expect(result.success).toBe(true);
    });
  });

  describe('clearFcmToken', () => {
    it('should clear FCM token', async () => {
      const result = await controller.clearFcmToken(mockReq, authHeader);
      expect(result.success).toBe(true);
    });
  });

  describe('getLoginAlertsStatus', () => {
    it('should return login alerts status', async () => {
      const result = await controller.getLoginAlertsStatus(mockReq, authHeader);
      expect(result.success).toBe(true);
      expect(result.enabled).toBe(true);
    });
  });

  describe('toggleLoginAlerts', () => {
    it('should toggle login alerts', async () => {
      const result = await controller.toggleLoginAlerts(mockReq, authHeader, { enabled: false });
      expect(result.success).toBe(true);
      expect(result.enabled).toBe(false);
    });
  });

  describe('logoutSession', () => {
    it('should logout a specific session', async () => {
      const result = await controller.logoutSession(mockReq, 5);
      expect(result.success).toBe(true);
    });
  });

  describe('logoutOtherSessions', () => {
    it('should logout other sessions', async () => {
      const result = await controller.logoutOtherSessions(mockReq, authHeader);
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });
  });

  describe('logoutAllSessions', () => {
    it('should logout all sessions', async () => {
      const result = await controller.logoutAllSessions(mockReq);
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
    });
  });
});

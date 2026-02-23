import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SessionsService } from './sessions.service';
import { UserSession } from '../entities/user-session.entity';
import { FcmService } from '../fcm/fcm.service';

describe('SessionsService', () => {
  let service: SessionsService;
  let mockRepo: any;
  let mockCache: any;
  let mockFcmService: any;
  let mockQueryBuilder: any;

  beforeEach(async () => {
    mockQueryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 2 }),
    };

    mockRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: 1 })),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: entity.id || 1 })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    mockFcmService = {
      sendLoginAlert: jest.fn().mockResolvedValue({ successCount: 1, failedTokens: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: getRepositoryToken(UserSession), useValue: mockRepo },
        { provide: CACHE_MANAGER, useValue: mockCache },
        { provide: FcmService, useValue: mockFcmService },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSession', () => {
    it('should update existing session for same platform', async () => {
      const existingSession = {
        id: 1,
        userId: 1,
        platform: 'android',
        isActive: true,
        fcmToken: 'old-token',
      };
      mockRepo.findOne.mockResolvedValue(existingSession);

      const result = await service.createSession({
        userId: 1,
        token: 'jwt-token-very-long-string-here-12345',
        platform: 'android' as any,
        deviceName: 'Pixel 7',
        fcmToken: 'new-fcm-token',
      });

      expect(mockRepo.save).toHaveBeenCalled();
      expect(mockCache.del).toHaveBeenCalledWith('user_sessions:1');
    });

    it('should create new session if no existing for platform', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.find.mockResolvedValue([]); // for login alert

      const result = await service.createSession({
        userId: 1,
        token: 'jwt-token-very-long-string-here-12345',
        platform: 'ios' as any,
        deviceName: 'iPhone 15',
      });

      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });

  describe('getUserSessions', () => {
    it('should return cached sessions if available', async () => {
      const cachedSessions = [{ id: 1, platform: 'android', isCurrent: false }];
      mockCache.get.mockResolvedValue(cachedSessions);

      const result = await service.getUserSessions(1);

      expect(result).toHaveLength(1);
      expect(mockRepo.find).not.toHaveBeenCalled();
    });

    it('should query database if no cache', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.find.mockResolvedValue([
        {
          id: 1,
          platform: 'android',
          deviceName: 'Pixel',
          deviceModel: null,
          osVersion: null,
          appVersion: null,
          ipAddress: null,
          location: null,
          loginAt: new Date(),
          lastActivityAt: new Date(),
          token: 'hash123',
        },
      ]);

      const result = await service.getUserSessions(1);

      expect(result).toHaveLength(1);
      expect(mockCache.set).toHaveBeenCalled();
    });
  });

  describe('logoutSession', () => {
    it('should deactivate session and blacklist token', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 5,
        userId: 1,
        isActive: true,
        token: 'hash-abc',
        fcmToken: 'fcm-123',
      });

      const result = await service.logoutSession(1, 5);

      expect(result.success).toBe(true);
      expect(mockRepo.save).toHaveBeenCalled();
      expect(mockCache.set).toHaveBeenCalledWith(
        'token_blacklist:hash-abc',
        true,
        86400000,
      );
    });

    it('should return failure if session not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.logoutSession(1, 999);

      expect(result.success).toBe(false);
    });
  });

  describe('logoutAllOtherSessions', () => {
    it('should logout all other sessions', async () => {
      mockRepo.find.mockResolvedValue([
        { id: 2, token: 'hash-2' },
        { id: 3, token: 'hash-3' },
      ]);

      const result = await service.logoutAllOtherSessions(1, 'current-token-long-enough-for-hashing');

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(mockCache.set).toHaveBeenCalledTimes(2); // 2 blacklist tokens
    });
  });

  describe('logoutAllSessions', () => {
    it('should logout all sessions including current', async () => {
      mockRepo.find.mockResolvedValue([
        { id: 1, token: 'hash-1' },
        { id: 2, token: 'hash-2' },
      ]);

      const result = await service.logoutAllSessions(1);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });
  });

  describe('isTokenBlacklisted', () => {
    it('should return true for blacklisted token', async () => {
      mockCache.get.mockResolvedValue(true);

      const result = await service.isTokenBlacklisted('some-token-that-is-long-enough');
      expect(result).toBe(true);
    });

    it('should return false for valid token', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await service.isTokenBlacklisted('some-valid-token-long-enough');
      expect(result).toBe(false);
    });
  });

  describe('cleanupOldSessions', () => {
    it('should delete old inactive sessions', async () => {
      const result = await service.cleanupOldSessions(30);
      expect(result).toBe(2);
    });
  });

  describe('getPlatformIcon', () => {
    it('should return correct icon for each platform', () => {
      expect(SessionsService.getPlatformIcon('android')).toBe('phone_android');
      expect(SessionsService.getPlatformIcon('ios')).toBe('phone_iphone');
      expect(SessionsService.getPlatformIcon('web')).toBe('computer');
      expect(SessionsService.getPlatformIcon('windows')).toBe('desktop_windows');
      expect(SessionsService.getPlatformIcon('macos')).toBe('desktop_mac');
      expect(SessionsService.getPlatformIcon('linux')).toBe('computer');
      expect(SessionsService.getPlatformIcon('unknown')).toBe('devices');
    });
  });

  describe('updateFcmToken', () => {
    it('should update FCM token with exact match', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.updateFcmToken(1, 'jwt-token-long-enough-here', 'new-fcm-token');

      expect(result.success).toBe(true);
    });

    it('should fallback to latest session if no exact match', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 });
      mockRepo.findOne.mockResolvedValue({
        id: 1,
        userId: 1,
        isActive: true,
        fcmToken: null,
      });

      const result = await service.updateFcmToken(1, 'jwt-token-long-enough', 'new-fcm');

      expect(result.success).toBe(true);
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('should create new session if none exists', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 });
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.updateFcmToken(1, 'jwt-token-long-enough', 'fcm-token');

      expect(result.success).toBe(true);
      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });

  describe('clearFcmToken', () => {
    it('should clear FCM token with exact match', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.clearFcmToken(1, 'jwt-token-long-enough');

      expect(result.success).toBe(true);
    });

    it('should fallback to latest session', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 });
      mockRepo.findOne.mockResolvedValue({
        id: 1,
        userId: 1,
        isActive: true,
        fcmToken: 'old-token',
      });

      const result = await service.clearFcmToken(1, 'jwt-token-long-enough');

      expect(result.success).toBe(true);
    });

    it('should return success even if no session found', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 });
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.clearFcmToken(1, 'jwt-token-long-enough');

      expect(result.success).toBe(true);
    });
  });

  describe('toggleLoginAlerts', () => {
    it('should toggle login alerts on', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.toggleLoginAlerts(1, 'jwt-token-long-enough', true);

      expect(result.success).toBe(true);
    });

    it('should toggle login alerts off', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 });

      const result = await service.toggleLoginAlerts(1, 'jwt-token-long-enough', false);

      expect(result.success).toBe(false);
    });
  });

  describe('getLoginAlertsStatus', () => {
    it('should return login alerts status', async () => {
      mockRepo.findOne.mockResolvedValue({
        loginAlertsEnabled: true,
        fcmToken: 'some-token',
      });

      const result = await service.getLoginAlertsStatus(1, 'jwt-token-long-enough');

      expect(result.enabled).toBe(true);
      expect(result.hasFcmToken).toBe(true);
    });

    it('should return defaults if no session found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.getLoginAlertsStatus(1, 'jwt-token-long-enough');

      expect(result.enabled).toBe(true);
      expect(result.hasFcmToken).toBe(false);
    });
  });
});

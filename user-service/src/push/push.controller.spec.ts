import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PushController } from './push.controller';
import { FcmService } from '../fcm/fcm.service';
import { UserSession } from '../entities/user-session.entity';
import { UserSettings } from '../entities/user-settings.entity';

// Mock firebase-admin for testFcm/debugFcm that require('firebase-admin')
jest.mock('firebase-admin', () => ({
  apps: [{ name: 'default' }],
  app: jest.fn().mockReturnValue({ options: { projectId: 'test-project' } }),
}));

describe('PushController', () => {
  let controller: PushController;
  let fcmService: any;
  let sessionRepo: any;
  let settingsRepo: any;

  const defaultSettings = {
    pushNotifications: true,
    pushLikes: true,
    pushComments: true,
    pushNewFollowers: true,
    pushMentions: true,
    pushMessages: true,
    pushProfileViews: true,
    loginAlertsEnabled: true,
    inAppLikes: true,
    inAppComments: true,
    inAppNewFollowers: true,
    inAppMentions: true,
    inAppMessages: true,
    inAppProfileViews: true,
  };

  beforeEach(async () => {
    fcmService = {
      sendToDevice: jest.fn().mockResolvedValue(true),
      sendToDevices: jest.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        failedTokens: [],
        errors: [],
      }),
    };

    sessionRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 1, fcmToken: 'token-abc-1234567890abcdef1234567890abcdef', platform: 'ios', isActive: true, deviceName: 'iPhone', lastActivityAt: new Date(), loginAt: new Date() },
      ]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    settingsRepo = {
      findOne: jest.fn().mockResolvedValue(defaultSettings),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PushController],
      providers: [
        { provide: FcmService, useValue: fcmService },
        { provide: getRepositoryToken(UserSession), useValue: sessionRepo },
        { provide: getRepositoryToken(UserSettings), useValue: settingsRepo },
      ],
    }).compile();

    controller = module.get<PushController>(PushController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ========== SEND PUSH NOTIFICATION ==========
  describe('sendPushNotification', () => {
    it('should send push to user with valid tokens', async () => {
      const result = await controller.sendPushNotification({ userId: '1', title: 'Test', body: 'Test body' });
      expect(result.success).toBe(true);
      expect(result.sentTo).toBe(1);
      expect(fcmService.sendToDevices).toHaveBeenCalled();
    });

    it('should return failure when no FCM tokens', async () => {
      sessionRepo.find.mockResolvedValue([{ id: 1, fcmToken: null }]);
      const result = await controller.sendPushNotification({ userId: '1', title: 'Test', body: 'Body' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('No active devices');
    });

    it('should return failure when empty string tokens', async () => {
      sessionRepo.find.mockResolvedValue([{ id: 1, fcmToken: '' }]);
      const result = await controller.sendPushNotification({ userId: '1', title: 'Test', body: 'Body' });
      expect(result.success).toBe(false);
    });

    it('should respect push notification preferences - master disabled', async () => {
      settingsRepo.findOne.mockResolvedValue({ pushNotifications: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'Test', body: 'Body', data: { type: 'like' } });
      expect(result.success).toBe(false);
      expect(result.message).toContain('disabled');
    });

    it('should respect granular - likes disabled', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, pushLikes: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'L', body: 'B', data: { type: 'like' } });
      expect(result.success).toBe(false);
    });

    it('should respect granular - comments disabled', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, pushComments: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'C', body: 'B', data: { type: 'comment' } });
      expect(result.success).toBe(false);
    });

    it('should respect granular - reply uses comment setting', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, pushComments: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'R', body: 'B', data: { type: 'reply' } });
      expect(result.success).toBe(false);
    });

    it('should respect granular - followers disabled', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, pushNewFollowers: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'F', body: 'B', data: { type: 'follow' } });
      expect(result.success).toBe(false);
    });

    it('should respect granular - follow_request uses followers setting', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, pushNewFollowers: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'F', body: 'B', data: { type: 'follow_request' } });
      expect(result.success).toBe(false);
    });

    it('should respect granular - follow_request_accepted uses followers setting', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, pushNewFollowers: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'F', body: 'B', data: { type: 'follow_request_accepted' } });
      expect(result.success).toBe(false);
    });

    it('should respect granular - mentions disabled', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, pushMentions: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'M', body: 'B', data: { type: 'mention' } });
      expect(result.success).toBe(false);
    });

    it('should respect granular - messages disabled', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, pushMessages: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'M', body: 'B', data: { type: 'message' } });
      expect(result.success).toBe(false);
    });

    it('should respect granular - profile_view disabled', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, pushProfileViews: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'P', body: 'B', data: { type: 'profile_view' } });
      expect(result.success).toBe(false);
    });

    it('should respect granular - login_alert disabled', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...defaultSettings, loginAlertsEnabled: false });
      const result = await controller.sendPushNotification({ userId: '1', title: 'L', body: 'B', data: { type: 'login_alert' } });
      expect(result.success).toBe(false);
    });

    it('should allow unknown notification types by default', async () => {
      const result = await controller.sendPushNotification({ userId: '1', title: 'X', body: 'B', data: { type: 'unknown_type' } });
      expect(result.success).toBe(true);
    });

    it('should allow when no data type provided', async () => {
      const result = await controller.sendPushNotification({ userId: '1', title: 'X', body: 'B' });
      expect(result.success).toBe(true);
    });

    it('should deduplicate FCM tokens', async () => {
      sessionRepo.find.mockResolvedValue([
        { id: 1, fcmToken: 'token-abc-1234567890abcdef1234567890abcdef' },
        { id: 2, fcmToken: 'token-abc-1234567890abcdef1234567890abcdef' },
      ]);
      await controller.sendPushNotification({ userId: '1', title: 'T', body: 'B' });
      const calledTokens = fcmService.sendToDevices.mock.calls[0][0];
      expect(calledTokens.length).toBe(1);
    });

    it('should clean up invalid FCM tokens', async () => {
      fcmService.sendToDevices.mockResolvedValue({
        successCount: 0, failureCount: 1,
        failedTokens: ['bad-token'],
        errors: [{ token: 'bad-t...', code: 'messaging/invalid-registration-token', message: 'Invalid' }],
      });
      sessionRepo.find.mockResolvedValue([{ id: 1, fcmToken: 'bad-token' }]);
      await controller.sendPushNotification({ userId: '1', title: 'T', body: 'B' });
      expect(sessionRepo.update).toHaveBeenCalledWith({ fcmToken: 'bad-token' }, { fcmToken: null });
    });

    it('should clean up unregistered tokens', async () => {
      fcmService.sendToDevices.mockResolvedValue({
        successCount: 0, failureCount: 1,
        failedTokens: ['old-token'],
        errors: [{ token: 'old-t...', code: 'messaging/registration-token-not-registered', message: 'Unregistered' }],
      });
      sessionRepo.find.mockResolvedValue([{ id: 1, fcmToken: 'old-token' }]);
      await controller.sendPushNotification({ userId: '1', title: 'T', body: 'B' });
      expect(sessionRepo.update).toHaveBeenCalled();
    });

    it('should NOT clean up tokens with transient errors', async () => {
      fcmService.sendToDevices.mockResolvedValue({
        successCount: 0, failureCount: 1,
        failedTokens: ['token'],
        errors: [{ token: 'tok...', code: 'messaging/internal-error', message: 'Temp' }],
      });
      sessionRepo.find.mockResolvedValue([{ id: 1, fcmToken: 'token' }]);
      await controller.sendPushNotification({ userId: '1', title: 'T', body: 'B' });
      expect(sessionRepo.update).not.toHaveBeenCalled();
    });

    it('should handle error in sendPushNotification gracefully', async () => {
      fcmService.sendToDevices.mockRejectedValue(new Error('FCM error'));
      const result = await controller.sendPushNotification({ userId: '1', title: 'T', body: 'B' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('FCM error');
    });

    it('should allow when no settings exist (defaults to enabled)', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const result = await controller.sendPushNotification({ userId: '1', title: 'T', body: 'B', data: { type: 'like' } });
      expect(result.success).toBe(true);
    });

    it('should handle cleanup error gracefully', async () => {
      fcmService.sendToDevices.mockResolvedValue({
        successCount: 0, failureCount: 1,
        failedTokens: ['bad-token'],
        errors: [{ token: 'bad', code: 'messaging/invalid-registration-token', message: 'Invalid' }],
      });
      sessionRepo.find.mockResolvedValue([{ id: 1, fcmToken: 'bad-token' }]);
      sessionRepo.update.mockRejectedValue(new Error('DB error'));
      // Should not throw
      const result = await controller.sendPushNotification({ userId: '1', title: 'T', body: 'B' });
      expect(result).toBeDefined();
    });
  });

  // ========== TEST FCM ==========
  describe('testFcm', () => {
    it('should test FCM with manual token', async () => {
      const result = await controller.testFcm({ fcmToken: 'manual-test-token-1234567890abcdef1234567890abcdef' });
      expect(result.tokensFound).toBe(1);
      expect(result.tokenSource).toBe('manual');
      expect(result.firebaseInitialized).toBe(true);
    });

    it('should test FCM with user tokens from DB', async () => {
      const result = await controller.testFcm({ userId: '1' });
      expect(result.tokensFound).toBe(1);
      expect(result.tokenSource).toBe('database');
    });

    it('should return error when no tokens found', async () => {
      sessionRepo.find.mockResolvedValue([]);
      const result = await controller.testFcm({ userId: '1' });
      expect(result.tokensFound).toBe(0);
      expect(result.error).toContain('No FCM tokens');
    });

    it('should handle sendToDevices error in test', async () => {
      fcmService.sendToDevices.mockRejectedValue(new Error('Send failed'));
      const result = await controller.testFcm({ fcmToken: 'test-token-abcdef1234567890abcdef1234567890ab' });
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toBe('Send failed');
    });

    it('should return empty when no userId or fcmToken provided', async () => {
      const result = await controller.testFcm({});
      expect(result.tokensFound).toBe(0);
    });
  });

  // ========== DEBUG FCM ==========
  describe('debugFcm', () => {
    it('should return debug info for user', async () => {
      const result = await controller.debugFcm('1');
      expect(result.userId).toBe('1');
      expect(result.firebase!.initialized).toBe(true);
      expect(result.totalSessions).toBe(1);
      expect(result.sessionsWithToken).toBe(1);
    });

    it('should return push settings', async () => {
      const result = await controller.debugFcm('1');
      expect(result.pushSettings!.pushNotifications).toBe(true);
    });

    it('should handle error in debugFcm', async () => {
      sessionRepo.find.mockRejectedValue(new Error('DB error'));
      const result = await controller.debugFcm('1');
      expect(result.error).toBe('DB error');
    });

    it('should handle null settings', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const result = await controller.debugFcm('1');
      expect(result.pushSettings!.pushNotifications).toBe(true); // defaults
    });
  });

  // ========== CHECK NOTIFICATION PREFERENCE ==========
  describe('checkNotificationPreference', () => {
    it('should return enabled for like', async () => {
      expect((await controller.checkNotificationPreference('1', 'like')).enabled).toBe(true);
    });

    it('should return disabled when in-app likes off', async () => {
      settingsRepo.findOne.mockResolvedValue({ inAppLikes: false });
      expect((await controller.checkNotificationPreference('1', 'like')).enabled).toBe(false);
    });

    it('should return enabled when no settings', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      expect((await controller.checkNotificationPreference('1', 'comment')).enabled).toBe(true);
    });

    it('should check comment type', async () => {
      expect((await controller.checkNotificationPreference('1', 'comment')).enabled).toBe(true);
    });

    it('should check reply uses comment setting', async () => {
      settingsRepo.findOne.mockResolvedValue({ inAppComments: false });
      expect((await controller.checkNotificationPreference('1', 'reply')).enabled).toBe(false);
    });

    it('should check follow type', async () => {
      expect((await controller.checkNotificationPreference('1', 'follow')).enabled).toBe(true);
    });

    it('should check follow_request type', async () => {
      settingsRepo.findOne.mockResolvedValue({ inAppNewFollowers: false });
      expect((await controller.checkNotificationPreference('1', 'follow_request')).enabled).toBe(false);
    });

    it('should check follow_request_accepted type', async () => {
      settingsRepo.findOne.mockResolvedValue({ inAppNewFollowers: false });
      expect((await controller.checkNotificationPreference('1', 'follow_request_accepted')).enabled).toBe(false);
    });

    it('should check mention type', async () => {
      settingsRepo.findOne.mockResolvedValue({ inAppMentions: false });
      expect((await controller.checkNotificationPreference('1', 'mention')).enabled).toBe(false);
    });

    it('should check message type', async () => {
      expect((await controller.checkNotificationPreference('1', 'message')).enabled).toBe(true);
    });

    it('should check profile_view type', async () => {
      settingsRepo.findOne.mockResolvedValue({ inAppProfileViews: false });
      expect((await controller.checkNotificationPreference('1', 'profile_view')).enabled).toBe(false);
    });

    it('should default to enabled for unknown type', async () => {
      expect((await controller.checkNotificationPreference('1', 'unknown_type')).enabled).toBe(true);
    });

    it('should handle error and default to enabled', async () => {
      settingsRepo.findOne.mockRejectedValue(new Error('DB error'));
      const result = await controller.checkNotificationPreference('1', 'like');
      expect(result.enabled).toBe(true);
    });
  });
});

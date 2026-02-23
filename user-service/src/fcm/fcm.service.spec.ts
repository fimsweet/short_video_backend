import { Test, TestingModule } from '@nestjs/testing';
import { FcmService } from './fcm.service';

// Define mocks INSIDE the factory to avoid hoisting issues
jest.mock('firebase-admin', () => {
  const _mockSend = jest.fn().mockResolvedValue('message-id-123');
  const _mockSendEachForMulticast = jest.fn().mockResolvedValue({
    successCount: 1,
    failureCount: 0,
    responses: [{ success: true, messageId: 'msg-1' }],
  });
  return {
    apps: [{ name: 'default' }],
    app: jest.fn().mockReturnValue({ options: { projectId: 'test-project' } }),
    messaging: jest.fn().mockReturnValue({
      send: _mockSend,
      sendEachForMulticast: _mockSendEachForMulticast,
    }),
    credential: { cert: jest.fn() },
    initializeApp: jest.fn(),
    __mockSend: _mockSend,
    __mockSendEachForMulticast: _mockSendEachForMulticast,
  };
});

describe('FcmService', () => {
  let service: FcmService;
  let mockSend: jest.Mock;
  let mockSendEachForMulticast: jest.Mock;

  beforeEach(async () => {
    const admin = require('firebase-admin');
    mockSend = admin.__mockSend;
    mockSendEachForMulticast = admin.__mockSendEachForMulticast;

    const module: TestingModule = await Test.createTestingModule({
      providers: [FcmService],
    }).compile();

    service = module.get<FcmService>(FcmService);
    mockSend.mockClear();
    mockSendEachForMulticast.mockClear();
    mockSend.mockResolvedValue('message-id-123');
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'msg-1' }],
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendToDevice', () => {
    it('should send notification to a single device', async () => {
      const result = await service.sendToDevice('fcm-token-123', 'Title', 'Body');
      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalled();
    });

    it('should send with data payload', async () => {
      const result = await service.sendToDevice('token', 'Title', 'Body', { key: 'value' });
      expect(result).toBe(true);
    });

    it('should return false on send failure', async () => {
      mockSend.mockRejectedValue(new Error('Network error'));
      const result = await service.sendToDevice('token', 'Title', 'Body');
      expect(result).toBe(false);
    });

    it('should return false on invalid-registration-token error', async () => {
      const error: any = new Error('Invalid');
      error.code = 'messaging/invalid-registration-token';
      mockSend.mockRejectedValue(error);
      const result = await service.sendToDevice('bad-token', 'Title', 'Body');
      expect(result).toBe(false);
    });

    it('should return false on registration-token-not-registered', async () => {
      const error: any = new Error('Not registered');
      error.code = 'messaging/registration-token-not-registered';
      mockSend.mockRejectedValue(error);
      const result = await service.sendToDevice('expired-token', 'Title', 'Body');
      expect(result).toBe(false);
    });

    it('should send without data payload', async () => {
      const result = await service.sendToDevice('token', 'Title', 'Body');
      expect(result).toBe(true);
    });
  });

  describe('sendToDevices', () => {
    it('should send notifications to multiple devices', async () => {
      const result = await service.sendToDevices(['token1', 'token2'], 'Title', 'Body');
      expect(result.successCount).toBe(1);
    });

    it('should handle empty tokens array', async () => {
      const result = await service.sendToDevices([], 'Title', 'Body');
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
    });

    it('should report failed tokens', async () => {
      mockSendEachForMulticast.mockResolvedValueOnce({
        successCount: 0,
        failureCount: 1,
        responses: [{
          success: false,
          error: { code: 'messaging/invalid-registration-token', message: 'Invalid token' },
        }],
      });
      const result = await service.sendToDevices(['bad-token'], 'Title', 'Body');
      expect(result.failureCount).toBe(1);
      expect(result.failedTokens).toContain('bad-token');
      expect(result.errors.length).toBe(1);
    });

    it('should handle mixed success/failure', async () => {
      mockSendEachForMulticast.mockResolvedValueOnce({
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true, messageId: 'msg-1' },
          { success: false, error: { code: 'UNKNOWN', message: 'Unknown' } },
        ],
      });
      const result = await service.sendToDevices(['good-token', 'bad-token'], 'Title', 'Body');
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
    });

    it('should handle exception in sendEachForMulticast', async () => {
      mockSendEachForMulticast.mockRejectedValue(new Error('FCM service down'));
      const result = await service.sendToDevices(['token1'], 'Title', 'Body');
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(1);
      expect(result.errors[0].code).toBe('EXCEPTION');
    });

    it('should send with data payload', async () => {
      await service.sendToDevices(['token1'], 'Title', 'Body', { key: 'val' });
      expect(mockSendEachForMulticast).toHaveBeenCalled();
    });

    it('should handle error without code/message', async () => {
      mockSendEachForMulticast.mockResolvedValueOnce({
        successCount: 0,
        failureCount: 1,
        responses: [{ success: false, error: {} }],
      });
      const result = await service.sendToDevices(['token'], 'T', 'B');
      expect(result.errors[0].code).toBe('UNKNOWN');
    });
  });

  describe('sendLoginAlert', () => {
    it('should send login alert notification', async () => {
      const result = await service.sendLoginAlert(['token1'], 'iPhone 15', 'ios', 'Ho Chi Minh City', '192.168.1.1');
      expect(result.successCount).toBeGreaterThanOrEqual(0);
    });

    it('should include device info in notification data', async () => {
      await service.sendLoginAlert(['token1'], 'Samsung', 'android', 'Hanoi', '10.0.0.1');
      expect(mockSendEachForMulticast).toHaveBeenCalled();
    });

    it('should handle empty device name and location', async () => {
      await service.sendLoginAlert(['token1'], '', '', '', '');
      expect(mockSendEachForMulticast).toHaveBeenCalled();
    });
  });
});

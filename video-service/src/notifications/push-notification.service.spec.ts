import { PushNotificationService } from './push-notification.service';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('PushNotificationService', () => {
  let service: PushNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    const config = { get: jest.fn().mockReturnValue('http://localhost:3000') };
    service = new PushNotificationService(config as any);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('sendToUser', () => {
    it('should send successfully', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true, sentTo: 1 }) });
      const result = await service.sendToUser({ userId: 'u1', title: 'T', body: 'B' });
      expect(result).toBe(true);
    });

    it('should return false on HTTP error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('error') });
      expect(await service.sendToUser({ userId: 'u1', title: 'T', body: 'B' })).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('network'));
      expect(await service.sendToUser({ userId: 'u1', title: 'T', body: 'B' })).toBe(false);
    });

    it('should default success to false when missing', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({}) });
      // success is undefined → ?? false
      expect(await service.sendToUser({ userId: 'u1', title: 'T', body: 'B' })).toBe(false);
    });
  });

  describe('isNotificationEnabled', () => {
    it('should return enabled value', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ enabled: false }) });
      expect(await service.isNotificationEnabled('u1', 'like')).toBe(false);
    });

    it('should default to true on error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      expect(await service.isNotificationEnabled('u1', 'like')).toBe(true);
    });

    it('should default to true on exception', async () => {
      mockFetch.mockRejectedValue(new Error('fail'));
      expect(await service.isNotificationEnabled('u1', 'like')).toBe(true);
    });
  });

  describe('sanitizeMessagePreview (via sendMessageNotification)', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true }) });
    });

    it('should pass plain text through', async () => {
      await service.sendMessageNotification('u1', 'Alice', 'Hello!', 'c1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).toBe('Hello!');
    });

    it('should sanitize IMAGE tag to friendly text', async () => {
      await service.sendMessageNotification('u1', 'Alice', '[IMAGE:http://img.jpg]', 'c1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).toContain('ảnh');
    });

    it('should keep text with IMAGE tag', async () => {
      await service.sendMessageNotification('u1', 'Alice', 'Check this\n[IMAGE:http://img.jpg]', 'c1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).toBe('Check this');
    });

    it('should sanitize STACKED_IMAGE tag', async () => {
      await service.sendMessageNotification('u1', 'Alice', '[STACKED_IMAGE:1,2,3]', 'c1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).toContain('nhiều ảnh');
    });

    it('should sanitize VIDEO_SHARE tag', async () => {
      await service.sendMessageNotification('u1', 'Alice', '[VIDEO_SHARE:abc]', 'c1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).toContain('video');
    });

    it('should sanitize THEME_CHANGE tag', async () => {
      await service.sendMessageNotification('u1', 'Alice', '[THEME_CHANGE:blue]', 'c1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).toContain('chủ đề');
    });

    it('should truncate long messages', async () => {
      const longText = 'a'.repeat(100);
      await service.sendMessageNotification('u1', 'Alice', longText, 'c1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body.length).toBeLessThanOrEqual(53); // 50 + '...'
    });
  });

  describe('sendFollowNotification', () => {
    it('should send with avatar', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true }) });
      await service.sendFollowNotification('u1', 'Bob', 'http://avatar.jpg');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.followerAvatar).toBe('http://avatar.jpg');
    });

    it('should default avatar to empty string', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true }) });
      await service.sendFollowNotification('u1', 'Bob');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.followerAvatar).toBe('');
    });
  });

  describe('sendFollowRequestNotification', () => {
    it('should send follow request notification', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true }) });
      await service.sendFollowRequestNotification('u1', 'Charlie');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.type).toBe('follow_request');
    });
  });

  describe('sendFollowRequestAcceptedNotification', () => {
    it('should send accepted notification', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true }) });
      await service.sendFollowRequestAcceptedNotification('u1', 'Diana');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.type).toBe('follow_request_accepted');
    });
  });

  describe('sendLikeNotification', () => {
    it('should include video title when provided', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true }) });
      await service.sendLikeNotification('u1', 'Eve', 'My Video');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).toContain('My Video');
    });

    it('should omit title when not provided', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true }) });
      await service.sendLikeNotification('u1', 'Eve');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).not.toContain(':');
    });
  });

  describe('sendCommentNotification', () => {
    it('should truncate long comment', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true }) });
      await service.sendCommentNotification('u1', 'Frank', 'c'.repeat(100), 'v1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body.length).toBeLessThanOrEqual(53);
    });

    it('should keep short comment as-is', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ success: true }) });
      await service.sendCommentNotification('u1', 'Frank', 'Nice!', 'v1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).toBe('Nice!');
    });
  });
});

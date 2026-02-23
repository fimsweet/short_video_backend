import { PrivacyService } from './privacy.service';
import { ConfigService } from '@nestjs/config';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('PrivacyService', () => {
  let service: PrivacyService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    const configService = { get: jest.fn().mockReturnValue('http://localhost:3000') };
    service = new PrivacyService(configService as any);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('checkPermission', () => {
    it('should allow same user', async () => {
      const result = await service.checkPermission('u1', 'u1', 'view_video');
      expect(result.allowed).toBe(true);
    });

    it('should return result from user-service', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ allowed: false, reason: 'Private' }) });
      const result = await service.checkPermission('u1', 'u2', 'view_video');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Private');
    });

    it('should return allowed on HTTP error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      const result = await service.checkPermission('u1', 'u2', 'view_video');
      expect(result.allowed).toBe(true);
    });

    it('should return allowed on fetch exception', async () => {
      mockFetch.mockRejectedValue(new Error('network'));
      const result = await service.checkPermission('u1', 'u2', 'comment');
      expect(result.allowed).toBe(true);
    });

    it('should include isDeactivated', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ allowed: false, isDeactivated: true }) });
      const result = await service.checkPermission('u1', 'u2', 'send_message');
      expect(result.isDeactivated).toBe(true);
    });
  });

  describe('getPrivacySettings', () => {
    it('should return settings from user-service', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ settings: { accountPrivacy: 'private' } }) });
      const result = await service.getPrivacySettings('u1');
      expect(result.accountPrivacy).toBe('private');
    });

    it('should return defaults on error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      const result = await service.getPrivacySettings('u1');
      expect(result.accountPrivacy).toBe('public');
    });

    it('should return defaults on exception', async () => {
      mockFetch.mockRejectedValue(new Error('fail'));
      const result = await service.getPrivacySettings('u1');
      expect(result.whoCanViewVideos).toBe('everyone');
    });
  });

  describe('getPrivacySettingsBatch', () => {
    it('should return map of settings', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => ({ settings: { '1': { accountPrivacy: 'private' }, '2': { accountPrivacy: 'public' } } }),
      });
      const result = await service.getPrivacySettingsBatch(['1', '2']);
      expect(result.get('1')?.accountPrivacy).toBe('private');
      expect(result.get('2')?.accountPrivacy).toBe('public');
    });

    it('should return empty map for empty input', async () => {
      const result = await service.getPrivacySettingsBatch([]);
      expect(result.size).toBe(0);
    });

    it('should return defaults on error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      const result = await service.getPrivacySettingsBatch(['1']);
      expect(result.get('1')?.accountPrivacy).toBe('public');
    });

    it('should deduplicate user ids', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ settings: {} }) });
      await service.getPrivacySettingsBatch(['1', '1', '2']);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.userIds).toEqual([1, 2]);
    });
  });

  describe('getDeactivatedUserIds', () => {
    it('should return set of deactivated ids', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ deactivatedIds: [1, 3] }) });
      const result = await service.getDeactivatedUserIds(['1', '2', '3']);
      expect(result.has('1')).toBe(true);
      expect(result.has('3')).toBe(true);
      expect(result.has('2')).toBe(false);
    });

    it('should return empty set on empty input', async () => {
      expect((await service.getDeactivatedUserIds([])).size).toBe(0);
    });

    it('should return empty set on error', async () => {
      mockFetch.mockRejectedValue(new Error('fail'));
      expect((await service.getDeactivatedUserIds(['1'])).size).toBe(0);
    });
  });

  describe('filterVideosByPrivacy', () => {
    it('should filter out private accounts', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => ({ settings: { '2': { accountPrivacy: 'private', whoCanViewVideos: 'everyone' } } }) })
        .mockResolvedValueOnce({ ok: true, json: () => ({ deactivatedIds: [] }) });
      const videos = [{ userId: '2', id: 'v1' }];
      const filtered = await service.filterVideosByPrivacy(videos);
      expect(filtered).toHaveLength(0);
    });

    it('should filter out deactivated users', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => ({ settings: {} }) })
        .mockResolvedValueOnce({ ok: true, json: () => ({ deactivatedIds: [2] }) });
      const videos = [{ userId: '2', id: 'v1' }];
      const filtered = await service.filterVideosByPrivacy(videos);
      expect(filtered).toHaveLength(0);
    });

    it('should keep public videos', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => ({ settings: { '2': { accountPrivacy: 'public', whoCanViewVideos: 'everyone' } } }) })
        .mockResolvedValueOnce({ ok: true, json: () => ({ deactivatedIds: [] }) });
      const videos = [{ userId: '2', id: 'v1' }];
      const filtered = await service.filterVideosByPrivacy(videos);
      expect(filtered).toHaveLength(1);
    });

    it('should filter out onlyMe view setting', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => ({ settings: { '2': { accountPrivacy: 'public', whoCanViewVideos: 'onlyMe' } } }) })
        .mockResolvedValueOnce({ ok: true, json: () => ({ deactivatedIds: [] }) });
      const videos = [{ userId: '2', id: 'v1' }];
      const filtered = await service.filterVideosByPrivacy(videos);
      expect(filtered).toHaveLength(0);
    });

    it('should return empty for empty input', async () => {
      expect(await service.filterVideosByPrivacy([])).toEqual([]);
    });
  });

  describe('canViewVideo / canSendMessage / canComment', () => {
    it('canViewVideo delegates to checkPermission', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ allowed: true }) });
      expect((await service.canViewVideo('u1', 'u2')).allowed).toBe(true);
    });

    it('canSendMessage delegates to checkPermission', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ allowed: false, reason: 'blocked' }) });
      expect((await service.canSendMessage('u1', 'u2')).allowed).toBe(false);
    });

    it('canComment delegates to checkPermission', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ allowed: true }) });
      expect((await service.canComment('u1', 'u2')).allowed).toBe(true);
    });
  });

  describe('checkToxicityWithAI', () => {
    it('should return false for short content', async () => {
      expect(await service.checkToxicityWithAI('')).toBe(false);
      expect(await service.checkToxicityWithAI('a')).toBe(false);
    });

    it('should fall back to bad words when no API key', async () => {
      const cs = { get: jest.fn().mockReturnValue(undefined) };
      const svc = new PrivacyService(cs as any);
      expect(await svc.checkToxicityWithAI('fuck you')).toBe(true);
      expect(await svc.checkToxicityWithAI('hello world')).toBe(false);
    });

    it('should return TOXIC from Gemini', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => ({ candidates: [{ content: { parts: [{ text: 'TOXIC' }] } }] }),
      });
      const cs = { get: jest.fn().mockImplementation((k) => k === 'GEMINI_API_KEY' ? 'key123' : 'http://localhost:3000') };
      const svc = new PrivacyService(cs as any);
      expect(await svc.checkToxicityWithAI('very bad content')).toBe(true);
    });

    it('should return SAFE from Gemini', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => ({ candidates: [{ content: { parts: [{ text: 'SAFE' }] } }] }),
      });
      const cs = { get: jest.fn().mockImplementation((k) => k === 'GEMINI_API_KEY' ? 'key123' : 'http://localhost:3000') };
      const svc = new PrivacyService(cs as any);
      expect(await svc.checkToxicityWithAI('nice comment')).toBe(false);
    });

    it('should fall back on Gemini error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      const cs = { get: jest.fn().mockImplementation((k) => k === 'GEMINI_API_KEY' ? 'key123' : 'http://localhost:3000') };
      const svc = new PrivacyService(cs as any);
      expect(await svc.checkToxicityWithAI('hello')).toBe(false);
    });
  });

  describe('censorBadWords', () => {
    it('should censor bad words', () => {
      expect(service.censorBadWords('you are a fuck head')).toContain('***');
    });

    it('should return empty string as-is', () => {
      expect(service.censorBadWords('')).toBe('');
    });
  });

  describe('shouldFilterComment', () => {
    it('should return true when filter enabled and bad words present', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ settings: { filterComments: true } }) });
      expect(await service.shouldFilterComment('u1', 'fuck this')).toBe(true);
    });

    it('should return false when filter disabled', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ settings: { filterComments: false } }) });
      expect(await service.shouldFilterComment('u1', 'fuck this')).toBe(false);
    });

    it('should return false for clean content', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ settings: { filterComments: true } }) });
      expect(await service.shouldFilterComment('u1', 'nice video')).toBe(false);
    });
  });
});

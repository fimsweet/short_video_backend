/* eslint-disable @typescript-eslint/no-require-imports */
const mockClient = {
  cluster: { health: jest.fn() },
  indices: { exists: jest.fn(), create: jest.fn() },
  index: jest.fn(),
  delete: jest.fn(),
  search: jest.fn(),
  update: jest.fn(),
  bulk: jest.fn(),
  count: jest.fn(),
  close: jest.fn(),
};

jest.mock('@elastic/elasticsearch', () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SearchService } from './search.service';
import { Video, VideoStatus } from '../entities/video.entity';

describe('SearchService', () => {
  let service: SearchService;
  let videoRepo: any;
  let configService: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    videoRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'ELASTICSEARCH_NODE') return 'http://localhost:9200';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: getRepositoryToken(Video), useValue: videoRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('onModuleInit', () => {
    it('should connect and create indices', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(false);
      mockClient.indices.create.mockResolvedValue({});
      mockClient.count.mockResolvedValue({ count: 5 });

      await service.onModuleInit();
      expect(service.isAvailable()).toBe(true);
    });

    it('should handle connection failure gracefully', async () => {
      mockClient.cluster.health.mockRejectedValue(new Error('refused'));
      await service.onModuleInit();
      expect(service.isAvailable()).toBe(false);
    });

    it('should auto-sync videos when index is empty', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 0 });
      mockClient.bulk.mockResolvedValue({ errors: false });
      videoRepo.find.mockResolvedValue([
        { id: 'v1', userId: 'u1', title: 'Test', status: VideoStatus.READY, isHidden: false, createdAt: new Date() },
      ]);

      await service.onModuleInit();
      expect(mockClient.bulk).toHaveBeenCalled();
    });

    it('should skip auto-sync when not connected', async () => {
      mockClient.cluster.health.mockRejectedValue(new Error('refused'));
      await service.onModuleInit();
      expect(mockClient.count).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should close client', async () => {
      await service.onModuleDestroy();
      expect(mockClient.close).toHaveBeenCalled();
    });
  });

  describe('isAvailable', () => {
    it('should return false initially', () => {
      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('indexVideo', () => {
    it('should index when connected', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.index.mockResolvedValue({});
      await service.indexVideo({ id: 'v1', userId: 'u1', title: 'Test', description: '', thumbnailUrl: '', hlsUrl: '', aspectRatio: '9:16', viewCount: 0, likeCount: 0, commentCount: 0, createdAt: new Date() });
      expect(mockClient.index).toHaveBeenCalledWith(expect.objectContaining({ index: 'videos', id: 'v1' }));
    });

    it('should skip when not connected', async () => {
      await service.indexVideo({ id: 'v1' } as any);
      expect(mockClient.index).not.toHaveBeenCalled();
    });

    it('should handle error', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.index.mockRejectedValue(new Error('index fail'));
      await service.indexVideo({ id: 'v1' } as any);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('indexUser', () => {
    it('should index when connected', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.index.mockResolvedValue({});
      await service.indexUser({ id: 'u1', username: 'test', bio: '', avatar: '', followerCount: 0, createdAt: new Date() });
      expect(mockClient.index).toHaveBeenCalledWith(expect.objectContaining({ index: 'users', id: 'u1' }));
    });

    it('should skip when not connected', async () => {
      await service.indexUser({ id: 'u1' } as any);
      expect(mockClient.index).not.toHaveBeenCalled();
    });
  });

  describe('deleteVideo', () => {
    it('should delete when connected', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.delete.mockResolvedValue({});
      await service.deleteVideo('v1');
      expect(mockClient.delete).toHaveBeenCalledWith(expect.objectContaining({ index: 'videos', id: 'v1' }));
    });

    it('should skip when not connected', async () => {
      await service.deleteVideo('v1');
      expect(mockClient.delete).not.toHaveBeenCalled();
    });

    it('should handle error', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();
      mockClient.delete.mockRejectedValue(new Error('fail'));
      await service.deleteVideo('v1');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('should delete when connected', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.delete.mockResolvedValue({});
      await service.deleteUser('u1');
      expect(mockClient.delete).toHaveBeenCalledWith(expect.objectContaining({ index: 'users', id: 'u1' }));
    });

    it('should skip when not connected', async () => {
      await service.deleteUser('u1');
      expect(mockClient.delete).not.toHaveBeenCalled();
    });
  });

  describe('searchVideos', () => {
    it('should search and return results', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.search.mockResolvedValue({
        hits: { hits: [{ _source: { id: 'v1', title: 'Test' } }] },
      });
      const results = await service.searchVideos('test');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('v1');
    });

    it('should return empty when not connected', async () => {
      const results = await service.searchVideos('test');
      expect(results).toEqual([]);
    });

    it('should handle search error', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();
      mockClient.search.mockRejectedValue(new Error('search fail'));
      const results = await service.searchVideos('test');
      expect(results).toEqual([]);
    });
  });

  describe('searchUsers', () => {
    it('should search and return results', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.search.mockResolvedValue({
        hits: { hits: [{ _source: { id: 'u1', username: 'john' } }] },
      });
      const results = await service.searchUsers('john');
      expect(results).toHaveLength(1);
    });

    it('should return empty when not connected', async () => {
      expect(await service.searchUsers('test')).toEqual([]);
    });

    it('should handle error', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();
      mockClient.search.mockRejectedValue(new Error('fail'));
      expect(await service.searchUsers('test')).toEqual([]);
    });
  });

  describe('bulkIndexVideos', () => {
    it('should bulk index when connected', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.bulk.mockResolvedValue({ errors: false });
      await service.bulkIndexVideos([{ id: 'v1' } as any, { id: 'v2' } as any]);
      expect(mockClient.bulk).toHaveBeenCalled();
    });

    it('should skip when empty array', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();
      await service.bulkIndexVideos([]);
      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it('should log error when bulk has errors', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();
      mockClient.bulk.mockResolvedValue({ errors: true });
      await service.bulkIndexVideos([{ id: 'v1' } as any]);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('bulkIndexUsers', () => {
    it('should bulk index when connected', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.bulk.mockResolvedValue({ errors: false });
      await service.bulkIndexUsers([{ id: 'u1' } as any]);
      expect(mockClient.bulk).toHaveBeenCalled();
    });

    it('should skip when not connected', async () => {
      await service.bulkIndexUsers([{ id: 'u1' } as any]);
      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it('should skip when empty', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();
      await service.bulkIndexUsers([]);
      expect(mockClient.bulk).not.toHaveBeenCalled();
    });
  });

  describe('updateVideoCounts', () => {
    it('should update when connected', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();

      mockClient.update.mockResolvedValue({});
      await service.updateVideoCounts('v1', { viewCount: 100, likeCount: 10 });
      expect(mockClient.update).toHaveBeenCalledWith(expect.objectContaining({ index: 'videos', id: 'v1' }));
    });

    it('should skip when not connected', async () => {
      await service.updateVideoCounts('v1', { viewCount: 100 });
      expect(mockClient.update).not.toHaveBeenCalled();
    });

    it('should ignore 404 errors', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();
      mockClient.update.mockRejectedValue({ meta: { statusCode: 404 }, message: 'not found' });
      await service.updateVideoCounts('v1', { viewCount: 100 });
      // Should not log error for 404
    });

    it('should log non-404 errors', async () => {
      mockClient.cluster.health.mockResolvedValue({ status: 'green' });
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.count.mockResolvedValue({ count: 1 });
      await service.onModuleInit();
      mockClient.update.mockRejectedValue({ meta: { statusCode: 500 }, message: 'server error' });
      await service.updateVideoCounts('v1', { viewCount: 100 });
      expect(console.error).toHaveBeenCalled();
    });
  });
});

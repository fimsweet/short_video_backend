import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { Video, VideoStatus } from '../entities/video.entity';

describe('SearchController', () => {
  let controller: SearchController;
  let searchService: any;
  let videoRepo: any;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    searchService = {
      isAvailable: jest.fn().mockReturnValue(true),
      searchVideos: jest.fn().mockResolvedValue([{ id: 'v1' }]),
      searchUsers: jest.fn().mockResolvedValue([{ id: 'u1' }]),
      bulkIndexVideos: jest.fn().mockResolvedValue(undefined),
    };
    videoRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        { provide: SearchService, useValue: searchService },
        { provide: getRepositoryToken(Video), useValue: videoRepo },
      ],
    }).compile();

    controller = module.get<SearchController>(SearchController);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('searchVideos', () => {
    it('should search via elasticsearch', async () => {
      const result = await controller.searchVideos('test');
      expect(result.source).toBe('elasticsearch');
      expect(result.count).toBe(1);
    });
    it('should fallback when ES not available', async () => {
      searchService.isAvailable.mockReturnValue(false);
      const result = await controller.searchVideos('test');
      expect(result.source).toBe('sql');
    });
    it('should parse limit', async () => {
      await controller.searchVideos('test', '10');
      expect(searchService.searchVideos).toHaveBeenCalledWith('test', 10);
    });
  });

  describe('searchUsers', () => {
    it('should search users', async () => {
      const result = await controller.searchUsers('john');
      expect(result.source).toBe('elasticsearch');
    });
    it('should fallback when not available', async () => {
      searchService.isAvailable.mockReturnValue(false);
      const result = await controller.searchUsers('john');
      expect(result.source).toBe('sql');
    });
  });

  describe('getStatus', () => {
    it('should report connected', async () => {
      const result = await controller.getStatus();
      expect(result.elasticsearch).toBe('connected');
    });
    it('should report disconnected', async () => {
      searchService.isAvailable.mockReturnValue(false);
      const result = await controller.getStatus();
      expect(result.elasticsearch).toBe('disconnected');
    });
  });

  describe('syncVideos', () => {
    it('should sync videos', async () => {
      videoRepo.find.mockResolvedValue([{ id: 'v1', title: 'Test', createdAt: new Date() }]);
      const result = await controller.syncVideos();
      expect(result.success).toBe(true);
    });
    it('should fail when ES not available', async () => {
      searchService.isAvailable.mockReturnValue(false);
      const result = await controller.syncVideos();
      expect(result.success).toBe(false);
    });
    it('should handle sync error', async () => {
      videoRepo.find.mockRejectedValue(new Error('db error'));
      const result = await controller.syncVideos();
      expect(result.success).toBe(false);
    });
  });
});

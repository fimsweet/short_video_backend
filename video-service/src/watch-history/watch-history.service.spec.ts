import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WatchHistoryService } from './watch-history.service';
import { WatchHistory } from '../entities/watch-history.entity';
import { CategoriesService } from '../categories/categories.service';

describe('WatchHistoryService', () => {
  let service: WatchHistoryService;
  let repo: any;
  let categoriesService: any;
  let qb: any;

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue({ totalWatchTime: '100', totalVideosWatched: '5', completedVideos: '3', avgWatchPercentage: '75.5' }),
    };
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      create: jest.fn().mockImplementation((d) => ({ id: 'wh1', ...d })),
      save: jest.fn().mockImplementation((d) => Promise.resolve(d)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    categoriesService = {
      getVideoCategoriesBulk: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WatchHistoryService,
        { provide: getRepositoryToken(WatchHistory), useValue: repo },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();
    service = module.get<WatchHistoryService>(WatchHistoryService);
    (service as any).categoriesService = categoriesService;
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('recordWatch', () => {
    it('should create new watch history entry', async () => {
      const result = await service.recordWatch('u1', 'v1', 30, 60);
      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
      expect(result.watchPercentage).toBe(50);
      expect(result.isCompleted).toBe(false);
    });

    it('should mark as completed when >= 90%', async () => {
      const result = await service.recordWatch('u1', 'v1', 55, 60);
      expect(result.isCompleted).toBe(true);
    });

    it('should cap watch percentage at 100', async () => {
      const result = await service.recordWatch('u1', 'v1', 80, 60);
      expect(result.watchPercentage).toBeLessThanOrEqual(100);
    });

    it('should handle zero video duration', async () => {
      const result = await service.recordWatch('u1', 'v1', 30, 0);
      expect(result.watchPercentage).toBe(0);
    });

    it('should update existing history with max values', async () => {
      repo.findOne.mockResolvedValue({
        id: 'wh1', userId: 'u1', videoId: 'v1',
        watchDuration: 20, videoDuration: 60, watchPercentage: 33,
        watchCount: 1, isCompleted: false, lastWatchedAt: new Date(),
      });
      const result = await service.recordWatch('u1', 'v1', 50, 60);
      expect(result.watchDuration).toBe(50);
      expect(result.watchCount).toBe(2);
    });

    it('should keep isCompleted true once set', async () => {
      repo.findOne.mockResolvedValue({
        id: 'wh1', userId: 'u1', videoId: 'v1',
        watchDuration: 55, videoDuration: 60, watchPercentage: 91,
        watchCount: 2, isCompleted: true, lastWatchedAt: new Date(),
      });
      const result = await service.recordWatch('u1', 'v1', 10, 60);
      expect(result.isCompleted).toBe(true);
    });
  });

  describe('getUserWatchHistory', () => {
    it('should return paginated history', async () => {
      repo.findAndCount.mockResolvedValue([[{ id: 'wh1' }], 1]);
      const result = await service.getUserWatchHistory('u1', 20, 0);
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should use default limit and offset', async () => {
      await service.getUserWatchHistory('u1');
      expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ take: 50, skip: 0 }));
    });
  });

  describe('removeFromHistory', () => {
    it('should delete and return true', async () => {
      expect(await service.removeFromHistory('u1', 'v1')).toBe(true);
    });

    it('should return false when nothing deleted', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      expect(await service.removeFromHistory('u1', 'v1')).toBe(false);
    });
  });

  describe('clearHistory', () => {
    it('should delete all and return count', async () => {
      repo.delete.mockResolvedValue({ affected: 5 });
      expect(await service.clearHistory('u1')).toBe(5);
    });
  });

  describe('getWatchTimeBasedInterests', () => {
    it('should return empty array when no watch history', async () => {
      qb.getMany.mockResolvedValue([]);
      const result = await service.getWatchTimeBasedInterests('u1');
      expect(result).toEqual([]);
    });

    it('should calculate interests from watch history', async () => {
      qb.getMany.mockResolvedValue([
        { videoId: 'v1', watchDuration: 100, isCompleted: true, watchCount: 2 },
        { videoId: 'v2', watchDuration: 50, isCompleted: false, watchCount: 1 },
      ]);
      categoriesService.getVideoCategoriesBulk.mockResolvedValue(new Map([
        ['v1', [{ categoryId: 1, categoryName: 'Music' }]],
        ['v2', [{ categoryId: 1, categoryName: 'Music' }, { categoryId: 2, categoryName: 'Dance' }]],
      ]));
      const result = await service.getWatchTimeBasedInterests('u1');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].weight).toBeGreaterThan(0);
    });

    it('should boost weight for completed videos', async () => {
      qb.getMany.mockResolvedValue([
        { videoId: 'v1', watchDuration: 100, isCompleted: true, watchCount: 1 },
      ]);
      categoriesService.getVideoCategoriesBulk.mockResolvedValue(new Map([
        ['v1', [{ categoryId: 1, categoryName: 'Music' }]],
      ]));
      const result = await service.getWatchTimeBasedInterests('u1');
      // completed gets 1.5x boost
      expect(result[0].totalWatchTime).toBe(150);
    });

    it('should boost weight for rewatched videos', async () => {
      qb.getMany.mockResolvedValue([
        { videoId: 'v1', watchDuration: 100, isCompleted: false, watchCount: 3 },
      ]);
      categoriesService.getVideoCategoriesBulk.mockResolvedValue(new Map([
        ['v1', [{ categoryId: 1, categoryName: 'Music' }]],
      ]));
      const result = await service.getWatchTimeBasedInterests('u1');
      // rewatch 3 times: 100 * (1 + 0.2*2) = 140
      expect(result[0].totalWatchTime).toBe(140);
    });

    it('should handle videos without categories', async () => {
      qb.getMany.mockResolvedValue([
        { videoId: 'v1', watchDuration: 100, isCompleted: false, watchCount: 1 },
      ]);
      categoriesService.getVideoCategoriesBulk.mockResolvedValue(new Map());
      const result = await service.getWatchTimeBasedInterests('u1');
      expect(result).toEqual([]);
    });

    it('should cap weight at 2', async () => {
      qb.getMany.mockResolvedValue([
        { videoId: 'v1', watchDuration: 100, isCompleted: true, watchCount: 6 },
      ]);
      categoriesService.getVideoCategoriesBulk.mockResolvedValue(new Map([
        ['v1', [{ categoryId: 1, categoryName: 'Music' }]],
      ]));
      const result = await service.getWatchTimeBasedInterests('u1');
      expect(result[0].weight).toBeLessThanOrEqual(2);
    });

    it('should sort interests by weight descending', async () => {
      qb.getMany.mockResolvedValue([
        { videoId: 'v1', watchDuration: 50, isCompleted: false, watchCount: 1 },
        { videoId: 'v2', watchDuration: 200, isCompleted: true, watchCount: 3 },
      ]);
      categoriesService.getVideoCategoriesBulk.mockResolvedValue(new Map([
        ['v1', [{ categoryId: 1, categoryName: 'Music' }]],
        ['v2', [{ categoryId: 2, categoryName: 'Dance' }]],
      ]));
      const result = await service.getWatchTimeBasedInterests('u1');
      expect(result[0].weight).toBeGreaterThanOrEqual(result[result.length - 1].weight);
    });
  });

  describe('hasWatched', () => {
    it('should return true if watched', async () => {
      repo.count.mockResolvedValue(1);
      expect(await service.hasWatched('u1', 'v1')).toBe(true);
    });

    it('should return false if not watched', async () => {
      expect(await service.hasWatched('u1', 'v1')).toBe(false);
    });
  });

  describe('getWatchedVideoIds', () => {
    it('should return video ids', async () => {
      repo.find.mockResolvedValue([{ videoId: 'v1' }, { videoId: 'v2' }]);
      const result = await service.getWatchedVideoIds('u1');
      expect(result).toEqual(['v1', 'v2']);
    });
  });

  describe('getUserWatchStats', () => {
    it('should return aggregated stats', async () => {
      const result = await service.getUserWatchStats('u1');
      expect(result.totalWatchTime).toBe(100);
      expect(result.totalVideosWatched).toBe(5);
      expect(result.completedVideos).toBe(3);
      expect(result.avgWatchPercentage).toBe(75.5);
    });

    it('should handle null stats', async () => {
      qb.getRawOne.mockResolvedValue({ totalWatchTime: null, totalVideosWatched: null, completedVideos: null, avgWatchPercentage: null });
      const result = await service.getUserWatchStats('u1');
      expect(result.totalWatchTime).toBe(0);
      expect(result.totalVideosWatched).toBe(0);
    });
  });
});

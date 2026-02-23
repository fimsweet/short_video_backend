import { Test, TestingModule } from '@nestjs/testing';
import { WatchHistoryController } from './watch-history.controller';
import { WatchHistoryService } from './watch-history.service';

describe('WatchHistoryController', () => {
  let controller: WatchHistoryController;
  let service: any;

  beforeEach(async () => {
    service = {
      recordWatch: jest.fn().mockResolvedValue({ id: 'wh1', watchPercentage: 80, isCompleted: false, watchCount: 1 }),
      getUserWatchHistory: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getWatchTimeBasedInterests: jest.fn().mockResolvedValue([]),
      getUserWatchStats: jest.fn().mockResolvedValue({ totalWatched: 10 }),
      removeFromHistory: jest.fn().mockResolvedValue(true),
      clearHistory: jest.fn().mockResolvedValue(5),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WatchHistoryController],
      providers: [{ provide: WatchHistoryService, useValue: service }],
    }).compile();

    controller = module.get<WatchHistoryController>(WatchHistoryController);
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });

  describe('recordWatch', () => {
    it('should record watch', async () => {
      const result = await controller.recordWatch({ userId: 'u1', videoId: 'v1', watchDuration: 20, videoDuration: 30 });
      expect(result.success).toBe(true);
      expect(result.data.watchPercentage).toBe(80);
    });
  });

  describe('getUserHistory', () => {
    it('should return history', async () => {
      const result = await controller.getUserHistory('u1');
      expect(result.success).toBe(true);
    });
    it('should pass limit and offset', async () => {
      await controller.getUserHistory('u1', 10, 5);
      expect(service.getUserWatchHistory).toHaveBeenCalledWith('u1', 10, 5);
    });
  });

  describe('getWatchInterests', () => {
    it('should return interests', async () => {
      const result = await controller.getWatchInterests('u1');
      expect(result.success).toBe(true);
    });
  });

  describe('getUserStats', () => {
    it('should return stats', async () => {
      const result = await controller.getUserStats('u1');
      expect(result.success).toBe(true);
    });
  });

  describe('removeFromHistory', () => {
    it('should remove entry', async () => {
      const result = await controller.removeFromHistory('u1', 'v1');
      expect(result.success).toBe(true);
    });
    it('should return false if not found', async () => {
      service.removeFromHistory.mockResolvedValue(false);
      const result = await controller.removeFromHistory('u1', 'v1');
      expect(result.success).toBe(false);
    });
  });

  describe('clearHistory', () => {
    it('should clear all', async () => {
      const result = await controller.clearHistory('u1');
      expect(result.deletedCount).toBe(5);
    });
  });
});

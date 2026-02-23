import { Test, TestingModule } from '@nestjs/testing';
import { ActivityHistoryController } from './activity-history.controller';
import { ActivityHistoryService } from './activity-history.service';

describe('ActivityHistoryController', () => {
  let controller: ActivityHistoryController;
  let service: jest.Mocked<Partial<ActivityHistoryService>>;

  beforeEach(async () => {
    service = {
      logActivity: jest.fn().mockResolvedValue({ id: 1, userId: 1, actionType: 'like' }),
      getActivityHistory: jest.fn().mockResolvedValue({ activities: [], total: 0, hasMore: false }),
      deleteActivity: jest.fn().mockResolvedValue({ success: true, message: 'Deleted' }),
      deleteAllActivities: jest.fn().mockResolvedValue({ success: true, deletedCount: 5 }),
      deleteActivitiesByType: jest.fn().mockResolvedValue({ success: true, deletedCount: 3 }),
      deleteActivitiesByTimeRange: jest.fn().mockResolvedValue({ success: true, deletedCount: 2 }),
      getActivityCount: jest.fn().mockResolvedValue({ count: 10 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivityHistoryController],
      providers: [
        { provide: ActivityHistoryService, useValue: service },
      ],
    }).compile();

    controller = module.get<ActivityHistoryController>(ActivityHistoryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('logActivity', () => {
    it('should log an activity', async () => {
      const result = await controller.logActivity({ userId: 1, actionType: 'like' });
      expect(result).toHaveProperty('id');
      expect(service.logActivity).toHaveBeenCalled();
    });
  });

  describe('getActivityHistory', () => {
    it('should return activity history', async () => {
      const result = await controller.getActivityHistory('1', '1', '20', 'videos');
      expect(result).toHaveProperty('activities');
      expect(service.getActivityHistory).toHaveBeenCalledWith(1, 1, 20, 'videos');
    });
  });

  describe('deleteActivity', () => {
    it('should delete a single activity', async () => {
      const result = await controller.deleteActivity('1', '5');
      expect(result.success).toBe(true);
    });
  });

  describe('deleteAllActivities', () => {
    it('should delete all activities', async () => {
      const result = await controller.deleteAllActivities('1');
      expect(result.success).toBe(true);
    });
  });

  describe('deleteActivitiesByType', () => {
    it('should delete by type', async () => {
      const result = await controller.deleteActivitiesByType('1', 'videos');
      expect(result.success).toBe(true);
    });
  });

  describe('deleteActivitiesByTimeRange', () => {
    it('should delete by time range', async () => {
      const result = await controller.deleteActivitiesByTimeRange('1', 'today', 'social');
      expect(result.success).toBe(true);
    });
  });

  describe('getActivityCount', () => {
    it('should return activity count', async () => {
      const result = await controller.getActivityCount('1', 'week', 'videos');
      expect(result.count).toBe(10);
    });
  });
});

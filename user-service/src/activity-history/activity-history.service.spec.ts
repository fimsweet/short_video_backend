import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ActivityHistoryService } from './activity-history.service';
import { ActivityHistory } from '../entities/activity-history.entity';

describe('ActivityHistoryService', () => {
  let service: ActivityHistoryService;
  let mockRepo: any;
  let mockQueryBuilder: any;

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(5),
      getMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 2 }),
    };

    mockRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 1, createdAt: new Date() })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      findOne: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityHistoryService,
        { provide: getRepositoryToken(ActivityHistory), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ActivityHistoryService>(ActivityHistoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('logActivity', () => {
    it('should create and save an activity', async () => {
      const dto = { userId: 1, actionType: 'like', targetId: '10', targetType: 'video' };
      const result = await service.logActivity(dto);

      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining(dto));
      expect(mockRepo.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('getActivityHistory', () => {
    it('should return paginated activities without filter', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([{ id: 1 }]);
      mockQueryBuilder.getCount.mockResolvedValue(1);

      const result = await service.getActivityHistory(1, 1, 20);

      expect(result.activities).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by videos type', async () => {
      await service.getActivityHistory(1, 1, 20, 'videos');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'activity.actionType IN (:...types)',
        expect.objectContaining({ types: ['video_posted', 'video_deleted', 'video_hidden'] }),
      );
    });

    it('should filter by social type', async () => {
      await service.getActivityHistory(1, 1, 20, 'social');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'activity.actionType IN (:...types)',
        expect.objectContaining({ types: ['follow', 'unfollow', 'like', 'unlike'] }),
      );
    });

    it('should filter by comments type', async () => {
      await service.getActivityHistory(1, 1, 20, 'comments');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'activity.actionType IN (:...types)',
        expect.objectContaining({ types: ['comment', 'comment_deleted'] }),
      );
    });

    it('should handle "all" filter as no filter', async () => {
      await service.getActivityHistory(1, 1, 20, 'all');

      // Should not add actionType filter for 'all'
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should calculate hasMore correctly', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(50);
      mockQueryBuilder.getMany.mockResolvedValue(Array(20).fill({ id: 1 }));

      const result = await service.getActivityHistory(1, 1, 20);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('deleteOldActivities', () => {
    it('should delete activities older than specified days', async () => {
      const result = await service.deleteOldActivities(1, 90);

      expect(result).toBe(2);
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
    });
  });

  describe('deleteActivity', () => {
    it('should delete a single activity', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 5, userId: 1 });

      const result = await service.deleteActivity(1, 5);

      expect(result.success).toBe(true);
      expect(mockRepo.remove).toHaveBeenCalled();
    });

    it('should return failure if activity not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.deleteActivity(1, 999);

      expect(result.success).toBe(false);
    });
  });

  describe('deleteAllActivities', () => {
    it('should delete all activities for a user', async () => {
      const result = await service.deleteAllActivities(1);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });
  });

  describe('deleteActivitiesByType', () => {
    it('should delete video activities', async () => {
      const result = await service.deleteActivitiesByType(1, 'videos');

      expect(result.success).toBe(true);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'actionType IN (:...types)',
        expect.objectContaining({ types: expect.arrayContaining(['video_posted']) }),
      );
    });

    it('should delete social activities', async () => {
      await service.deleteActivitiesByType(1, 'social');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should delete comment activities', async () => {
      await service.deleteActivitiesByType(1, 'comments');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should handle custom action type', async () => {
      await service.deleteActivitiesByType(1, 'custom_action');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'actionType IN (:...types)',
        { types: ['custom_action'] },
      );
    });

    it('should delete likes activities', async () => {
      await service.deleteActivitiesByType(1, 'likes');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should delete follows activities', async () => {
      await service.deleteActivitiesByType(1, 'follows');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });
  });

  describe('deleteActivitiesByTimeRange', () => {
    it('should delete today activities', async () => {
      const result = await service.deleteActivitiesByTimeRange(1, 'today');
      expect(result.success).toBe(true);
    });

    it('should delete week activities', async () => {
      const result = await service.deleteActivitiesByTimeRange(1, 'week');
      expect(result.success).toBe(true);
    });

    it('should delete month activities', async () => {
      const result = await service.deleteActivitiesByTimeRange(1, 'month');
      expect(result.success).toBe(true);
    });

    it('should delete all activities', async () => {
      const result = await service.deleteActivitiesByTimeRange(1, 'all');
      expect(result.success).toBe(true);
    });

    it('should apply type filter along with time range', async () => {
      await service.deleteActivitiesByTimeRange(1, 'today', 'videos');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2); // time + type
    });

    it('should handle social filter in time range', async () => {
      await service.deleteActivitiesByTimeRange(1, 'week', 'social');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should handle comments filter in time range', async () => {
      await service.deleteActivitiesByTimeRange(1, 'month', 'comments');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should handle likes filter in time range', async () => {
      await service.deleteActivitiesByTimeRange(1, 'today', 'likes');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should handle follows filter in time range', async () => {
      await service.deleteActivitiesByTimeRange(1, 'week', 'follows');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should handle custom filter in time range', async () => {
      await service.deleteActivitiesByTimeRange(1, 'all', 'custom');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });
  });

  describe('getActivityCount', () => {
    it('should return count for today', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(10);
      const result = await service.getActivityCount(1, 'today');
      expect(result.count).toBe(10);
    });

    it('should return count for week', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(25);
      const result = await service.getActivityCount(1, 'week');
      expect(result.count).toBe(25);
    });

    it('should return count for month', async () => {
      const result = await service.getActivityCount(1, 'month');
      expect(result).toHaveProperty('count');
    });

    it('should return count for all time', async () => {
      const result = await service.getActivityCount(1, 'all');
      expect(result).toHaveProperty('count');
    });

    it('should apply type filter to count', async () => {
      await service.getActivityCount(1, 'today', 'videos');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
    });

    it('should handle social filter in count', async () => {
      await service.getActivityCount(1, 'week', 'social');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should handle comments filter in count', async () => {
      await service.getActivityCount(1, 'month', 'comments');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should handle likes filter in count', async () => {
      await service.getActivityCount(1, 'today', 'likes');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should handle follows filter in count', async () => {
      await service.getActivityCount(1, 'week', 'follows');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LikesService } from './likes.service';
import { Like } from '../entities/like.entity';
import { Video } from '../entities/video.entity';
import { CommentsService } from '../comments/comments.service';
import { SavedVideosService } from '../saved-videos/saved-videos.service';
import { SharesService } from '../shares/shares.service';
import { ActivityLoggerService } from '../config/activity-logger.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('LikesService', () => {
  let service: LikesService;
  let likeRepo: any;
  let videoRepo: any;
  let commentsService: any;
  let savedVideosService: any;
  let sharesService: any;
  let activityLoggerService: any;
  let notificationsService: any;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    likeRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue({ id: 1 }),
      remove: jest.fn(),
      count: jest.fn().mockResolvedValue(10),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue({ ...mockQueryBuilder }),
    };
    videoRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'v1', userId: 'u2', title: 'Test', thumbnailUrl: 'thumb.jpg' }),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };
    commentsService = { getCommentCount: jest.fn().mockResolvedValue(2) };
    savedVideosService = { getSaveCount: jest.fn().mockResolvedValue(1) };
    sharesService = { getShareCount: jest.fn().mockResolvedValue(0) };
    activityLoggerService = { logActivity: jest.fn() };
    notificationsService = { createNotification: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LikesService,
        { provide: getRepositoryToken(Like), useValue: likeRepo },
        { provide: getRepositoryToken(Video), useValue: videoRepo },
        { provide: CommentsService, useValue: commentsService },
        { provide: SavedVideosService, useValue: savedVideosService },
        { provide: SharesService, useValue: sharesService },
        { provide: ActivityLoggerService, useValue: activityLoggerService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();
    service = module.get<LikesService>(LikesService);
    // Inject forwardRef deps manually
    (service as any).commentsService = commentsService;
    (service as any).savedVideosService = savedVideosService;
    (service as any).sharesService = sharesService;
    (service as any).activityLoggerService = activityLoggerService;
    (service as any).notificationsService = notificationsService;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('UT-SOC-01: Interaction toggle consistency', () => {
    describe('toggleLike', () => {
      it('should like a video when not already liked', async () => {
        likeRepo.findOne.mockResolvedValue(null);
        const result = await service.toggleLike('v1', 'u1');
        expect(result.liked).toBe(true);
        expect(likeRepo.save).toHaveBeenCalledWith({ videoId: 'v1', userId: 'u1' });
        expect(activityLoggerService.logActivity).toHaveBeenCalled();
      });

      it('should unlike a video when already liked', async () => {
        likeRepo.findOne.mockResolvedValue({ id: 1, videoId: 'v1', userId: 'u1' });
        const result = await service.toggleLike('v1', 'u1');
        expect(result.liked).toBe(false);
        expect(likeRepo.remove).toHaveBeenCalled();
      });

      it('should send notification when liking another user video', async () => {
        likeRepo.findOne.mockResolvedValue(null);
        await service.toggleLike('v1', 'u1');
        expect(notificationsService.createNotification).toHaveBeenCalled();
      });

      it('should not send notification when liking own video', async () => {
        likeRepo.findOne.mockResolvedValue(null);
        videoRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', title: 'My Video' });
        await service.toggleLike('v1', 'u1');
        expect(notificationsService.createNotification).not.toHaveBeenCalled();
      });

      it('should handle notification error gracefully', async () => {
        likeRepo.findOne.mockResolvedValue(null);
        notificationsService.createNotification.mockRejectedValue(new Error('fail'));
        const result = await service.toggleLike('v1', 'u1');
        expect(result.liked).toBe(true);
      });

      it('should handle video not found', async () => {
        videoRepo.findOne.mockResolvedValue(null);
        likeRepo.findOne.mockResolvedValue(null);
        const result = await service.toggleLike('v1', 'u1');
        expect(result.liked).toBe(true);
      });
    });
  });

  describe('getLikeCount', () => {
    it('should return like count', async () => {
      const count = await service.getLikeCount('v1');
      expect(count).toBe(10);
    });
  });

  describe('isLikedByUser', () => {
    it('should return true if liked', async () => {
      likeRepo.findOne.mockResolvedValue({ id: 1 });
      expect(await service.isLikedByUser('v1', 'u1')).toBe(true);
    });

    it('should return false if not liked', async () => {
      likeRepo.findOne.mockResolvedValue(null);
      expect(await service.isLikedByUser('v1', 'u1')).toBe(false);
    });
  });

  describe('getLikesByVideo', () => {
    it('should return likes ordered by createdAt DESC', async () => {
      likeRepo.find.mockResolvedValue([{ id: 2 }, { id: 1 }]);
      const result = await service.getLikesByVideo('v1');
      expect(result).toHaveLength(2);
    });
  });

  describe('getLikedVideosByUser', () => {
    it('should return liked videos with counts', async () => {
      likeRepo.find.mockResolvedValue([{ videoId: 'v1' }, { videoId: 'v2' }]);
      videoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'v1', viewCount: 100 },
        ]),
      });
      const result = await service.getLikedVideosByUser('u1');
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no likes', async () => {
      likeRepo.find.mockResolvedValue([]);
      const result = await service.getLikedVideosByUser('u1');
      expect(result).toEqual([]);
    });
  });

  describe('deleteAllLikesForVideo', () => {
    it('should delete all likes', async () => {
      await service.deleteAllLikesForVideo('v1');
      expect(likeRepo.delete).toHaveBeenCalledWith({ videoId: 'v1' });
    });
  });

  describe('getTotalReceivedLikes', () => {
    it('should return total received likes', async () => {
      likeRepo.createQueryBuilder.mockReturnValue({
        ...mockQueryBuilder,
        getCount: jest.fn().mockResolvedValue(42),
      });
      const result = await service.getTotalReceivedLikes('u1');
      expect(result).toBe(42);
    });
  });

  describe('getUsersWithSimilarTaste', () => {
    it('should return similar users', async () => {
      likeRepo.find.mockResolvedValue([{ videoId: 'v1' }, { videoId: 'v2' }]);
      likeRepo.createQueryBuilder.mockReturnValue({
        ...mockQueryBuilder,
        getRawMany: jest.fn().mockResolvedValue([
          { userId: '5', commonLikes: '3' },
          { userId: '7', commonLikes: '2' },
        ]),
      });
      const result = await service.getUsersWithSimilarTaste('u1');
      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe(5);
      expect(result[0].commonLikes).toBe(3);
    });

    it('should return empty when user has no likes', async () => {
      likeRepo.find.mockResolvedValue([]);
      const result = await service.getUsersWithSimilarTaste('u1');
      expect(result).toEqual([]);
    });
  });

  describe('getCreatorsOfLikedVideos', () => {
    it('should return creators', async () => {
      likeRepo.createQueryBuilder.mockReturnValue({
        ...mockQueryBuilder,
        getRawMany: jest.fn().mockResolvedValue([
          { creatorId: '10', likedVideosCount: '5' },
        ]),
      });
      const result = await service.getCreatorsOfLikedVideos('u1');
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe(10);
      expect(result[0].likedVideosCount).toBe(5);
    });
  });
});

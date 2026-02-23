import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { Comment } from '../entities/comment.entity';
import { CommentLike } from '../entities/comment-like.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityLoggerService } from '../config/activity-logger.service';
import { PrivacyService } from '../config/privacy.service';

describe('CommentsService', () => {
  let service: CommentsService;
  let commentRepo: any;
  let commentLikeRepo: any;
  let notificationsService: any;
  let activityLoggerService: any;
  let privacyService: any;

  beforeEach(async () => {
    commentRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((data) => ({ id: 'c1', createdAt: new Date(), ...data })),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ ...data, id: data.id || 'c1' })),
      remove: jest.fn(),
      count: jest.fn().mockResolvedValue(5),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        query: jest.fn().mockResolvedValue([{ id: 'v1', userId: 'u2', allowComments: true, isHidden: false, visibility: 'public', title: 'Test', thumbnailUrl: 'thumb.jpg' }]),
      },
    };
    commentLikeRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockResolvedValue({ id: 1 }),
      remove: jest.fn(),
      count: jest.fn().mockResolvedValue(3),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    notificationsService = { createNotification: jest.fn().mockResolvedValue({}) };
    activityLoggerService = { logActivity: jest.fn() };
    privacyService = {
      canComment: jest.fn().mockResolvedValue({ allowed: true }),
      shouldFilterComment: jest.fn().mockResolvedValue(false),
      checkToxicityWithAI: jest.fn().mockResolvedValue(false),
      censorBadWords: jest.fn().mockImplementation((c) => c.replace(/bad/g, '***')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: getRepositoryToken(Comment), useValue: commentRepo },
        { provide: getRepositoryToken(CommentLike), useValue: commentLikeRepo },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ActivityLoggerService, useValue: activityLoggerService },
        { provide: PrivacyService, useValue: privacyService },
      ],
    }).compile();
    service = module.get<CommentsService>(CommentsService);
    (service as any).notificationsService = notificationsService;
    (service as any).activityLoggerService = activityLoggerService;
    (service as any).privacyService = privacyService;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createComment', () => {
    it('should create a comment and notify video owner', async () => {
      const result = await service.createComment('v1', 'u1', 'Nice video!');
      expect(commentRepo.save).toHaveBeenCalled();
      expect(notificationsService.createNotification).toHaveBeenCalled();
      expect(activityLoggerService.logActivity).toHaveBeenCalled();
    });

    it('should not notify when commenting on own video', async () => {
      commentRepo.manager.query.mockResolvedValue([{ id: 'v1', userId: 'u1', allowComments: true, isHidden: false, visibility: 'public' }]);
      await service.createComment('v1', 'u1', 'My own comment');
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('should throw when comments are disabled', async () => {
      commentRepo.manager.query.mockResolvedValue([{ id: 'v1', userId: 'u2', allowComments: false, isHidden: false, visibility: 'public' }]);
      await expect(service.createComment('v1', 'u1', 'Comment')).rejects.toThrow(ForbiddenException);
    });

    it('should throw when commenting on hidden video as non-owner', async () => {
      commentRepo.manager.query.mockResolvedValue([{ id: 'v1', userId: 'u2', allowComments: true, isHidden: true, visibility: 'public' }]);
      await expect(service.createComment('v1', 'u1', 'Comment')).rejects.toThrow(ForbiddenException);
    });

    it('should throw when commenting on private video as non-owner', async () => {
      commentRepo.manager.query.mockResolvedValue([{ id: 'v1', userId: 'u2', allowComments: true, isHidden: false, visibility: 'private' }]);
      await expect(service.createComment('v1', 'u1', 'Comment')).rejects.toThrow(ForbiddenException);
    });

    it('should throw when privacy check denies commenting', async () => {
      privacyService.canComment.mockResolvedValue({ allowed: false, reason: 'Blocked' });
      await expect(service.createComment('v1', 'u1', 'Comment')).rejects.toThrow(ForbiddenException);
    });

    it('should throw when comment contains bad words', async () => {
      privacyService.shouldFilterComment.mockResolvedValue(true);
      await expect(service.createComment('v1', 'u1', 'bad comment')).rejects.toThrow(BadRequestException);
    });

    it('should flag toxic content', async () => {
      privacyService.checkToxicityWithAI.mockResolvedValue(true);
      const result = await service.createComment('v1', 'u1', 'toxic stuff');
      expect(result.isToxic).toBe(true);
      expect(result.censoredContent).toBeDefined();
    });

    it('should handle toxicity check error gracefully', async () => {
      privacyService.checkToxicityWithAI.mockRejectedValue(new Error('AI down'));
      const result = await service.createComment('v1', 'u1', 'Normal comment');
      expect(result.isToxic).toBe(false);
    });

    it('should handle reply to a reply by finding root parent', async () => {
      commentRepo.findOne.mockResolvedValue({ id: 'c2', parentId: 'c1' });
      const result = await service.createComment('v1', 'u1', 'Reply', 'c2');
      expect(result.parentId).toBe('c1');
    });

    it('should handle reply to a top-level comment', async () => {
      commentRepo.findOne.mockResolvedValue({ id: 'c1', parentId: null });
      const result = await service.createComment('v1', 'u1', 'Reply', 'c1');
      expect(result.parentId).toBe('c1');
    });

    it('should handle notification error gracefully', async () => {
      notificationsService.createNotification.mockRejectedValue(new Error('notif fail'));
      const result = await service.createComment('v1', 'u1', 'Comment');
      expect(result).toBeDefined();
    });

    it('should handle no video found', async () => {
      commentRepo.manager.query.mockResolvedValue([]);
      const result = await service.createComment('v1', 'u1', 'Comment');
      expect(result).toBeDefined();
    });

    it('should include imageUrl if provided', async () => {
      const result = await service.createComment('v1', 'u1', 'With image', undefined, 'http://img.jpg');
      expect(result.imageUrl).toBe('http://img.jpg');
    });

    it('should handle allowComments === 0 (falsy)', async () => {
      commentRepo.manager.query.mockResolvedValue([{ id: 'v1', userId: 'u2', allowComments: 0, isHidden: false, visibility: 'public' }]);
      await expect(service.createComment('v1', 'u1', 'Comment')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getCommentsByVideo', () => {
    it('should return comments with counts', async () => {
      commentRepo.count.mockResolvedValue(2);
      commentRepo.find.mockResolvedValue([
        { id: 'c1', isPinned: false, createdAt: new Date('2024-01-01') },
        { id: 'c2', isPinned: true, createdAt: new Date('2024-01-02') },
      ]);
      commentLikeRepo.count.mockResolvedValue(1);
      commentRepo.count
        .mockResolvedValueOnce(2) // total
        .mockResolvedValueOnce(0) // reply count c1
        .mockResolvedValueOnce(1); // reply count c2

      const result = await service.getCommentsByVideo('v1', 20, 0);
      expect(result.comments).toBeDefined();
      expect(result.total).toBe(2);
    });

    it('should detect hasMore', async () => {
      commentRepo.count.mockResolvedValue(25);
      const manyComments = Array.from({ length: 21 }, (_, i) => ({
        id: `c${i}`, isPinned: false, createdAt: new Date(),
      }));
      commentRepo.find.mockResolvedValue(manyComments);
      const result = await service.getCommentsByVideo('v1', 20, 0);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getReplies', () => {
    it('should return replies with like counts', async () => {
      commentRepo.find.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
      commentLikeRepo.count.mockResolvedValue(2);
      const result = await service.getReplies('c1');
      expect(result).toHaveLength(2);
      expect(result[0].likeCount).toBe(2);
    });
  });

  describe('getCommentCount', () => {
    it('should return comment count', async () => {
      expect(await service.getCommentCount('v1')).toBe(5);
    });
  });

  describe('deleteComment', () => {
    it('should delete comment and its replies', async () => {
      commentRepo.findOne.mockResolvedValue({ id: 'c1', userId: 'u1', videoId: 'v1' });
      commentRepo.find.mockResolvedValue([]); // no replies
      const result = await service.deleteComment('c1', 'u1');
      expect(result).toBe(true);
      expect(commentRepo.remove).toHaveBeenCalled();
    });

    it('should return false if comment not found', async () => {
      commentRepo.findOne.mockResolvedValue(null);
      expect(await service.deleteComment('c1', 'u1')).toBe(false);
    });
  });

  describe('editComment', () => {
    it('should edit comment within 5 min window', async () => {
      commentRepo.findOne.mockResolvedValue({
        id: 'c1', userId: 'u1', content: 'old', createdAt: new Date(),
      });
      const result = await service.editComment('c1', 'u1', 'new content');
      expect(result.content).toBe('new content');
      expect(result.isEdited).toBe(true);
    });

    it('should throw if comment not found', async () => {
      commentRepo.findOne.mockResolvedValue(null);
      await expect(service.editComment('c1', 'u1', 'new')).rejects.toThrow(BadRequestException);
    });

    it('should throw if edit window expired (>5 min)', async () => {
      const oldDate = new Date();
      oldDate.setMinutes(oldDate.getMinutes() - 10);
      commentRepo.findOne.mockResolvedValue({
        id: 'c1', userId: 'u1', content: 'old', createdAt: oldDate,
      });
      await expect(service.editComment('c1', 'u1', 'new')).rejects.toThrow(BadRequestException);
    });

    it('should flag toxic edited content', async () => {
      commentRepo.findOne.mockResolvedValue({ id: 'c1', userId: 'u1', content: 'old', createdAt: new Date() });
      privacyService.checkToxicityWithAI.mockResolvedValue(true);
      const result = await service.editComment('c1', 'u1', 'toxic edit');
      expect(result.isToxic).toBe(true);
    });
  });

  describe('toggleCommentLike', () => {
    it('should like a comment', async () => {
      commentLikeRepo.findOne.mockResolvedValue(null);
      const result = await service.toggleCommentLike('c1', 'u1');
      expect(result.liked).toBe(true);
    });

    it('should unlike a comment', async () => {
      commentLikeRepo.findOne.mockResolvedValue({ id: 1 });
      const result = await service.toggleCommentLike('c1', 'u1');
      expect(result.liked).toBe(false);
    });
  });

  describe('isCommentLikedByUser', () => {
    it('should return true if liked', async () => {
      commentLikeRepo.findOne.mockResolvedValue({ id: 1 });
      expect(await service.isCommentLikedByUser('c1', 'u1')).toBe(true);
    });
  });

  describe('deleteAllCommentsForVideo', () => {
    it('should delete all comments and likes', async () => {
      commentRepo.find.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      await service.deleteAllCommentsForVideo('v1');
      expect(commentLikeRepo.delete).toHaveBeenCalledTimes(2);
      expect(commentRepo.delete).toHaveBeenCalledWith({ videoId: 'v1' });
    });
  });
});

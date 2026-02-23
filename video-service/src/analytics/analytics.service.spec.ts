import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Video } from '../entities/video.entity';
import { Like } from '../entities/like.entity';
import { Comment } from '../entities/comment.entity';
import { Share } from '../entities/share.entity';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let videoRepo: any;
  let likeRepo: any;
  let commentRepo: any;
  let shareRepo: any;
  let httpService: any;

  const makeQb = (countVal = 0, rawMany: any[] = []) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(countVal),
    getRawMany: jest.fn().mockResolvedValue(rawMany),
  });

  beforeEach(async () => {
    const likeQb = makeQb(10, [{ videoId: 'v1', count: '5' }, { videoId: 'v2', count: '3' }]);
    const commentQb = makeQb(4);
    const shareQb = makeQb(2);

    videoRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'v1', userId: 'u1', viewCount: 100, title: 'Video 1', thumbnailUrl: 'thumb1.jpg', createdAt: new Date() },
        { id: 'v2', userId: 'u1', viewCount: 50, title: 'Video 2', thumbnailUrl: 'thumb2.jpg', createdAt: new Date() },
      ]),
    };
    likeRepo = { createQueryBuilder: jest.fn().mockReturnValue(likeQb) };
    commentRepo = { createQueryBuilder: jest.fn().mockReturnValue(commentQb) };
    shareRepo = { createQueryBuilder: jest.fn().mockReturnValue(shareQb) };
    httpService = {
      get: jest.fn().mockReturnValue(of({ data: { followersCount: 100, followingCount: 50 } })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Video), useValue: videoRepo },
        { provide: getRepositoryToken(Like), useValue: likeRepo },
        { provide: getRepositoryToken(Comment), useValue: commentRepo },
        { provide: getRepositoryToken(Share), useValue: shareRepo },
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') } },
      ],
    }).compile();
    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('getUserAnalytics', () => {
    it('should return full analytics', async () => {
      const result = await service.getUserAnalytics('u1');
      expect(result.success).toBe(true);
      expect(result.analytics.overview.totalVideos).toBe(2);
      expect(result.analytics.overview.totalViews).toBe(150);
      expect(result.analytics.overview.followersCount).toBe(100);
      expect(result.analytics.topVideos).toBeDefined();
      expect(result.analytics.dailyStats).toHaveLength(7);
    });

    it('should handle no videos', async () => {
      videoRepo.find.mockResolvedValue([]);
      const result = await service.getUserAnalytics('u1');
      expect(result.analytics.overview.totalVideos).toBe(0);
      expect(result.analytics.overview.totalViews).toBe(0);
      expect(result.analytics.overview.engagementRate).toBe(0);
    });

    it('should handle user-service error gracefully', async () => {
      httpService.get.mockReturnValue(throwError(() => new Error('timeout')));
      const result = await service.getUserAnalytics('u1');
      expect(result.analytics.overview.followersCount).toBe(0);
      expect(result.analytics.overview.followingCount).toBe(0);
    });

    it('should calculate engagement rate correctly', async () => {
      const result = await service.getUserAnalytics('u1');
      // (likes + comments + shares) / views * 100
      const expected = ((10 + 4 + 2) / 150 * 100).toFixed(2);
      expect(result.analytics.overview.engagementRate).toBe(parseFloat(expected));
    });

    it('should sort top videos by views descending', async () => {
      const result = await service.getUserAnalytics('u1');
      const topVideos = result.analytics.topVideos;
      if (topVideos.length >= 2) {
        expect(topVideos[0].views).toBeGreaterThanOrEqual(topVideos[1].views);
      }
    });

    it('should include daily stats for last 7 days', async () => {
      const result = await service.getUserAnalytics('u1');
      expect(result.analytics.dailyStats).toHaveLength(7);
      result.analytics.dailyStats.forEach((day: any) => {
        expect(day).toHaveProperty('date');
        expect(day).toHaveProperty('views');
        expect(day).toHaveProperty('likes');
        expect(day).toHaveProperty('comments');
      });
    });

    it('should include distribution data', async () => {
      const result = await service.getUserAnalytics('u1');
      expect(result.analytics.distribution).toEqual(expect.objectContaining({
        likes: expect.any(Number),
        comments: expect.any(Number),
        shares: expect.any(Number),
      }));
    });

    it('should handle videos with null viewCount', async () => {
      videoRepo.find.mockResolvedValue([
        { id: 'v1', userId: 'u1', viewCount: null, title: 'V1', createdAt: new Date() },
      ]);
      const result = await service.getUserAnalytics('u1');
      expect(result.analytics.overview.totalViews).toBe(0);
    });
  });
});

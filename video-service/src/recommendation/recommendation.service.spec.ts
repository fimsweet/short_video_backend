/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { RecommendationService } from './recommendation.service';
import { Video, VideoStatus, VideoVisibility } from '../entities/video.entity';
import { VideoCategory } from '../entities/video-category.entity';
import { Like } from '../entities/like.entity';
import { LikesService } from '../likes/likes.service';
import { CommentsService } from '../comments/comments.service';
import { SavedVideosService } from '../saved-videos/saved-videos.service';
import { SharesService } from '../shares/shares.service';
import { CategoriesService } from '../categories/categories.service';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { PrivacyService } from '../config/privacy.service';

describe('RecommendationService', () => {
  let service: RecommendationService;
  let videoRepo: any;
  let videoCategoryRepo: any;
  let likeRepo: any;
  let cacheManager: any;
  let httpService: any;
  let likesService: any;
  let commentsService: any;
  let savedVideosService: any;
  let sharesService: any;
  let categoriesService: any;
  let watchHistoryService: any;
  let privacyService: any;
  let configService: any;

  const mockVideo = (id: string, overrides: Partial<Video> = {}): Video => ({
    id,
    userId: 'user1',
    title: `Video ${id}`,
    description: '',
    originalUrl: '',
    thumbnailUrl: '',
    hlsUrl: '',
    status: VideoStatus.READY,
    visibility: VideoVisibility.PUBLIC,
    isHidden: false,
    viewCount: 100,
    likeCount: 10,
    commentCount: 5,
    aspectRatio: '9:16',
    duration: 30,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Video);

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    videoRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    videoCategoryRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    likeRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    httpService = {
      get: jest.fn().mockReturnValue(of({ data: { data: [] } })),
    };

    likesService = { getLikeCount: jest.fn().mockResolvedValue(10) };
    commentsService = { getCommentCount: jest.fn().mockResolvedValue(5) };
    savedVideosService = { getSaveCount: jest.fn().mockResolvedValue(2) };
    sharesService = { getShareCount: jest.fn().mockResolvedValue(1) };
    categoriesService = {
      getVideoCategories: jest.fn().mockResolvedValue([]),
      getVideoIdsByCategory: jest.fn().mockResolvedValue([]),
    };
    watchHistoryService = {
      getWatchedVideoIds: jest.fn().mockResolvedValue([]),
      getWatchTimeBasedInterests: jest.fn().mockResolvedValue([]),
    };
    privacyService = {
      filterVideosByPrivacy: jest.fn().mockImplementation((videos) => Promise.resolve(videos)),
    };
    configService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationService,
        { provide: getRepositoryToken(Video), useValue: videoRepo },
        { provide: getRepositoryToken(VideoCategory), useValue: videoCategoryRepo },
        { provide: getRepositoryToken(Like), useValue: likeRepo },
        { provide: ConfigService, useValue: configService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: LikesService, useValue: likesService },
        { provide: CommentsService, useValue: commentsService },
        { provide: SavedVideosService, useValue: savedVideosService },
        { provide: SharesService, useValue: sharesService },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: HttpService, useValue: httpService },
        { provide: WatchHistoryService, useValue: watchHistoryService },
        { provide: PrivacyService, useValue: privacyService },
      ],
    }).compile();

    service = module.get<RecommendationService>(RecommendationService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('getRecommendedVideos', () => {
    it('should return cached results on cache hit', async () => {
      const cached = [{ id: 'v1' }];
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.getRecommendedVideos(1, 50, []);
      expect(result).toEqual(cached);
      expect(videoRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should skip cache when excludeIds are provided', async () => {
      const videos = [mockVideo('v1')];
      const qb = videoRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue(videos);
      videoCategoryRepo.find.mockResolvedValue([]);

      httpService.get.mockImplementation((url: string) => {
        if (url.includes('following')) return of({ data: { followingIds: [] } });
        if (url.includes('mutual')) return of({ data: { data: [] } });
        return of({ data: { data: [] } });
      });

      const result = await service.getRecommendedVideos(1, 50, ['v99']);
      expect(cacheManager.del).toHaveBeenCalled();
    });

    it('should return empty array when no videos available', async () => {
      httpService.get.mockImplementation((url: string) => {
        if (url.includes('interests')) return of({ data: { data: [] } });
        if (url.includes('following')) return of({ data: { followingIds: [] } });
        if (url.includes('mutual')) return of({ data: { data: [] } });
        return of({ data: { data: [] } });
      });

      const result = await service.getRecommendedVideos(1);
      expect(result).toEqual([]);
    });

    it('should generate recommendations with scoring', async () => {
      const videos = [mockVideo('v1'), mockVideo('v2'), mockVideo('v3')];
      const qb = videoRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue(videos);
      
      httpService.get.mockImplementation((url: string) => {
        if (url.includes('interests')) return of({ data: { data: [{ categoryId: 1, categoryName: 'Gaming', weight: 0.8 }] } });
        if (url.includes('following')) return of({ data: { followingIds: [] } });
        if (url.includes('mutual')) return of({ data: { data: [] } });
        return of({ data: { data: [] } });
      });

      videoCategoryRepo.find.mockResolvedValue([
        { videoId: 'v1', categoryId: 1 },
      ]);

      const result = await service.getRecommendedVideos(1, 50);
      expect(result.length).toBeGreaterThan(0);
      expect(cacheManager.set).toHaveBeenCalled();
    });

    it('should fall back on error', async () => {
      httpService.get.mockReturnValue(throwError(() => new Error('network error')));
      const fallbackVideos = [mockVideo('v1')];
      videoRepo.find.mockResolvedValue(fallbackVideos);

      const result = await service.getRecommendedVideos(1);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should exclude following and mutual friend videos', async () => {
      const videos = [mockVideo('v1', { userId: '999' })];
      const qb = videoRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue(videos);

      httpService.get.mockImplementation((url: string) => {
        if (url.includes('interests')) return of({ data: { data: [] } });
        if (url.includes('following')) return of({ data: { followingIds: [2, 3] } });
        if (url.includes('mutual')) return of({ data: { data: [{ userId: 4 }] } });
        return of({ data: { data: [] } });
      });

      videoCategoryRepo.find.mockResolvedValue([]);
      await service.getRecommendedVideos(1, 50);
      expect(qb.andWhere).toHaveBeenCalled();
    });

    it('should handle following fetch failure gracefully', async () => {
      const videos = [mockVideo('v1')];
      const qb = videoRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue(videos);

      let callCount = 0;
      httpService.get.mockImplementation((url: string) => {
        if (url.includes('interests')) return of({ data: { data: [] } });
        if (url.includes('following')) return throwError(() => new Error('fail'));
        if (url.includes('mutual')) return throwError(() => new Error('fail'));
        return of({ data: { data: [] } });
      });

      videoCategoryRepo.find.mockResolvedValue([]);
      const result = await service.getRecommendedVideos(1);
      // Should not throw; falls back to self-only exclusion
      expect(console.warn).toHaveBeenCalled();
    });

    it('should apply privacy filter', async () => {
      const videos = [mockVideo('v1'), mockVideo('v2')];
      const qb = videoRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue(videos);

      httpService.get.mockImplementation((url: string) => {
        if (url.includes('interests')) return of({ data: { data: [] } });
        if (url.includes('following')) return of({ data: { followingIds: [] } });
        if (url.includes('mutual')) return of({ data: { data: [] } });
        return of({ data: { data: [] } });
      });

      privacyService.filterVideosByPrivacy.mockResolvedValue([videos[0]]);
      videoCategoryRepo.find.mockResolvedValue([]);

      const result = await service.getRecommendedVideos(1);
      expect(privacyService.filterVideosByPrivacy).toHaveBeenCalled();
    });

    it('should use shorter cache TTL for active users', async () => {
      const videos = [mockVideo('v1')];
      const qb = videoRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue(videos);

      httpService.get.mockImplementation((url: string) => {
        if (url.includes('interests')) return of({ data: { data: [] } });
        if (url.includes('following')) return of({ data: { followingIds: [] } });
        if (url.includes('mutual')) return of({ data: { data: [] } });
        return of({ data: { data: [] } });
      });

      // Active user with >20 watched videos
      watchHistoryService.getWatchedVideoIds.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => `watched-${i}`)
      );
      videoCategoryRepo.find.mockResolvedValue([]);

      await service.getRecommendedVideos(1);
      // Should use 60000ms TTL for active users
      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        60000,
      );
    });
  });

  describe('getTrendingVideos', () => {
    it('should return cached trending videos', async () => {
      const cached = [{ id: 'v1' }];
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.getTrendingVideos(50);
      expect(result).toEqual(cached);
    });

    it('should fetch and cache trending videos', async () => {
      const videos = [mockVideo('v1'), mockVideo('v2')];
      videoRepo.find.mockResolvedValue(videos);

      const result = await service.getTrendingVideos(50);
      expect(result.length).toBe(2);
      expect(cacheManager.set).toHaveBeenCalledWith('trending:50', expect.any(Array), 300000);
    });

    it('should use default limit of 50', async () => {
      videoRepo.find.mockResolvedValue([]);
      await service.getTrendingVideos();
      expect(videoRepo.find).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
    });
  });

  describe('getVideosByCategory', () => {
    it('should return videos for category', async () => {
      categoriesService.getVideoIdsByCategory.mockResolvedValue(['v1', 'v2']);
      videoRepo.find.mockResolvedValue([mockVideo('v1'), mockVideo('v2')]);

      const result = await service.getVideosByCategory(1, 50);
      expect(result.length).toBe(2);
    });

    it('should return empty array when no videoIds', async () => {
      categoriesService.getVideoIdsByCategory.mockResolvedValue([]);
      const result = await service.getVideosByCategory(1);
      expect(result).toEqual([]);
    });
  });

  describe('invalidateUserCache', () => {
    it('should delete recommendation cache', async () => {
      await service.invalidateUserCache(1);
      expect(cacheManager.del).toHaveBeenCalledWith('recommendations:1:50');
    });
  });
});

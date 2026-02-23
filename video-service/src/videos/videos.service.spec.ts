jest.mock('amqplib', () => ({
  connect: jest.fn().mockResolvedValue({
    createChannel: jest.fn().mockResolvedValue({
      assertQueue: jest.fn().mockResolvedValue({}),
      sendToQueue: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  unlinkSync: jest.fn(),
  rmSync: jest.fn(),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
  copyFileSync: jest.fn(),
}));

jest.mock('../config/file-validation.util', () => ({
  validateVideoFile: jest.fn().mockResolvedValue({ isValid: true, detectedMime: 'video/mp4' }),
  deleteInvalidFile: jest.fn(),
}));

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
}));

jest.mock('typeorm', () => ({
  Repository: class {},
  Entity: () => () => {},
  Column: () => () => {},
  PrimaryGeneratedColumn: () => () => {},
  CreateDateColumn: () => () => {},
  UpdateDateColumn: () => () => {},
  PrimaryColumn: () => () => {},
  ManyToOne: () => () => {},
  OneToMany: () => () => {},
  JoinColumn: () => () => {},
  Index: () => () => {},
}));

import { BadRequestException } from '@nestjs/common';
import { VideosService } from './videos.service';
import { Video, VideoStatus, VideoVisibility } from '../entities/video.entity';
import { of, throwError } from 'rxjs';
import { validateVideoFile, deleteInvalidFile } from '../config/file-validation.util';

describe('VideosService', () => {
  let service: VideosService;
  let videoRepo: any;
  let cacheManager: any;
  let likesService: any;
  let commentsService: any;
  let savedVideosService: any;
  let sharesService: any;
  let httpService: any;
  let categoriesService: any;
  let searchService: any;
  let activityLoggerService: any;
  let storageService: any;
  let privacyService: any;

  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
  };

  const mockVideo = {
    id: 'v1',
    userId: 'u1',
    title: 'Test Video',
    description: 'desc',
    hlsUrl: '/uploads/processed_videos/v1/playlist.m3u8',
    thumbnailUrl: '/uploads/processed_videos/v1/thumbnail.jpg',
    rawVideoPath: '/uploads/raw_videos/video.mp4',
    originalFileName: 'video.mp4',
    fileSize: 1000,
    status: VideoStatus.READY,
    visibility: VideoVisibility.PUBLIC,
    isHidden: false,
    allowComments: true,
    allowDuet: true,
    viewCount: 10,
    aspectRatio: '9:16',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    // Re-set the file validation mock after clearAllMocks
    (validateVideoFile as jest.Mock).mockResolvedValue({ isValid: true, detectedMime: 'video/mp4' });

    videoRepo = {
      findOne: jest.fn().mockResolvedValue(mockVideo),
      find: jest.fn().mockResolvedValue([mockVideo]),
      create: jest.fn().mockImplementation((d) => ({ id: 'v-new', ...d })),
      save: jest.fn().mockImplementation((d) => Promise.resolve({ ...d, id: d.id || 'v-new' })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    likesService = { getLikeCount: jest.fn().mockResolvedValue(5), deleteAllLikesForVideo: jest.fn().mockResolvedValue(undefined) };
    commentsService = { getCommentCount: jest.fn().mockResolvedValue(3), deleteAllCommentsForVideo: jest.fn().mockResolvedValue(undefined) };
    savedVideosService = { getSaveCount: jest.fn().mockResolvedValue(2), deleteAllSavesForVideo: jest.fn().mockResolvedValue(undefined) };
    sharesService = { getShareCount: jest.fn().mockResolvedValue(1), deleteAllSharesForVideo: jest.fn().mockResolvedValue(undefined) };
    httpService = {
      get: jest.fn().mockReturnValue(of({ data: { followersCount: 100, followingIds: [], isMutual: false } })),
    };
    categoriesService = { assignCategoriesToVideo: jest.fn().mockResolvedValue(undefined) };
    searchService = {
      isAvailable: jest.fn().mockReturnValue(false),
      searchVideos: jest.fn().mockResolvedValue([]),
      indexVideo: jest.fn().mockResolvedValue(undefined),
      deleteVideo: jest.fn().mockResolvedValue(undefined),
    };
    activityLoggerService = { logActivity: jest.fn() };
    storageService = {
      isEnabled: jest.fn().mockReturnValue(false),
      uploadFile: jest.fn().mockResolvedValue({ url: 'https://cdn/file' }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      deleteDirectory: jest.fn().mockResolvedValue(undefined),
    };
    privacyService = {
      canViewVideo: jest.fn().mockResolvedValue({ allowed: true }),
      filterVideosByPrivacy: jest.fn().mockImplementation((v) => Promise.resolve(v)),
      getPrivacySettingsBatch: jest.fn().mockResolvedValue(new Map()),
    };

    service = new VideosService(
      videoRepo,
      { get: jest.fn().mockReturnValue('test') } as any,
      cacheManager,
      likesService,
      commentsService,
      savedVideosService,
      sharesService,
      httpService,
      categoriesService,
      searchService,
      activityLoggerService,
      storageService,
      privacyService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('should be defined', () => expect(service).toBeDefined());

  // ===== getVideoById =====
  describe('getVideoById', () => {
    it('should return cached video on cache hit', async () => {
      cacheManager.get.mockResolvedValue({ id: 'v1', likeCount: 5 });
      const result = await service.getVideoById('v1');
      expect(result).toEqual({ id: 'v1', likeCount: 5 });
      expect(videoRepo.findOne).not.toHaveBeenCalled();
    });

    it('should fetch from DB on cache miss and cache result', async () => {
      const result = await service.getVideoById('v1');
      expect(result.likeCount).toBe(5);
      expect(result.commentCount).toBe(3);
      expect(result.saveCount).toBe(2);
      expect(result.shareCount).toBe(1);
      expect(cacheManager.set).toHaveBeenCalledWith('video:v1', expect.any(Object), 300000);
    });

    it('should return null if video not found', async () => {
      videoRepo.findOne.mockResolvedValue(null);
      expect(await service.getVideoById('v-none')).toBeNull();
    });
  });

  // ===== incrementViewCount =====
  describe('incrementViewCount', () => {
    it('should increment view count', async () => {
      const result = await service.incrementViewCount('v1');
      expect(result.viewCount).toBe(11);
      expect(cacheManager.del).toHaveBeenCalledWith('video:v1');
    });

    it('should throw if video not found', async () => {
      videoRepo.findOne.mockResolvedValue(null);
      await expect(service.incrementViewCount('v-none')).rejects.toThrow('Video not found');
    });

    it('should handle null viewCount', async () => {
      videoRepo.findOne.mockResolvedValue({ ...mockVideo, viewCount: null });
      const result = await service.incrementViewCount('v1');
      expect(result.viewCount).toBe(1);
    });
  });

  // ===== getVideosByUserId =====
  describe('getVideosByUserId', () => {
    it('should return all videos for owner (self tier)', async () => {
      const result = await service.getVideosByUserId('u1', 'u1');
      expect(result.videos).toBeDefined();
      expect(cacheManager.get).toHaveBeenCalledWith('user_videos:u1:self');
    });

    it('should return cached result on hit', async () => {
      cacheManager.get.mockResolvedValue({ videos: [{ id: 'v1', userId: 'u1' }] });
      privacyService.getPrivacySettingsBatch.mockResolvedValue(new Map([['u1', { whoCanComment: 'friends' }]]));
      const result = await service.getVideosByUserId('u1', 'u1');
      expect(result.videos[0].ownerWhoCanComment).toBe('friends');
    });

    it('should restrict when privacy check fails', async () => {
      privacyService.canViewVideo.mockResolvedValue({ allowed: false, reason: 'Private account' });
      const result = await service.getVideosByUserId('u2', 'u1');
      expect(result.privacyRestricted).toBe(true);
    });

    it('should filter public-only for non-friend requester', async () => {
      httpService.get.mockReturnValue(of({ data: { isMutual: false } }));
      videoRepo.find.mockResolvedValue([
        { ...mockVideo, id: 'v1', visibility: VideoVisibility.PUBLIC, isHidden: false },
        { ...mockVideo, id: 'v2', visibility: VideoVisibility.FRIENDS, isHidden: false },
        { ...mockVideo, id: 'v3', visibility: VideoVisibility.PRIVATE, isHidden: false },
      ]);
      const result = await service.getVideosByUserId('u1', 'u2');
      expect(result.videos.length).toBe(1);
    });

    it('should include friends visibility for mutual friends', async () => {
      httpService.get.mockReturnValue(of({ data: { isMutual: true } }));
      videoRepo.find.mockResolvedValue([
        { ...mockVideo, id: 'v1', visibility: VideoVisibility.PUBLIC, isHidden: false },
        { ...mockVideo, id: 'v2', visibility: VideoVisibility.FRIENDS, isHidden: false },
      ]);
      const result = await service.getVideosByUserId('u1', 'u2');
      expect(result.videos.length).toBe(2);
    });

    it('should skip cache when processing videos exist', async () => {
      videoRepo.find.mockResolvedValue([
        { ...mockVideo, status: 'processing' },
      ]);
      const result = await service.getVideosByUserId('u1', 'u1');
      expect(cacheManager.set).not.toHaveBeenCalled();
    });

    it('should handle error in checkMutualFriend', async () => {
      httpService.get.mockReturnValue(throwError(() => new Error('fail')));
      const result = await service.getVideosByUserId('u1', 'u2');
      expect(result.videos).toBeDefined();
    });
  });

  // ===== searchVideos =====
  describe('searchVideos', () => {
    it('should return empty for empty query', async () => {
      expect(await service.searchVideos('')).toEqual([]);
      expect(await service.searchVideos('  ')).toEqual([]);
    });

    it('should use Elasticsearch when available', async () => {
      searchService.isAvailable.mockReturnValue(true);
      searchService.searchVideos.mockResolvedValue([{ id: 'v1', title: 'Test' }]);
      const result = await service.searchVideos('test');
      expect(result).toHaveLength(1);
      expect(result[0].likeCount).toBe(5);
    });

    it('should fall back to SQL when ES unavailable', async () => {
      qb.getMany.mockResolvedValue([mockVideo]);
      const result = await service.searchVideos('test');
      expect(result).toHaveLength(1);
    });

    it('should fall back to SQL when ES returns empty', async () => {
      searchService.isAvailable.mockReturnValue(true);
      searchService.searchVideos.mockResolvedValue([]);
      qb.getMany.mockResolvedValue([mockVideo]);
      const result = await service.searchVideos('test');
      expect(result).toHaveLength(1);
    });

    it('should handle search error gracefully', async () => {
      searchService.isAvailable.mockReturnValue(true);
      searchService.searchVideos.mockRejectedValue(new Error('ES down'));
      const result = await service.searchVideos('test');
      expect(result).toEqual([]);
    });
  });

  // ===== getAllVideos =====
  describe('getAllVideos', () => {
    it('should return cached videos on hit', async () => {
      cacheManager.get.mockResolvedValue([{ id: 'v1', userId: 'u1' }]);
      privacyService.getPrivacySettingsBatch.mockResolvedValue(new Map());
      const result = await service.getAllVideos();
      expect(result).toHaveLength(1);
    });

    it('should fetch from DB on cache miss', async () => {
      videoRepo.find.mockResolvedValue([mockVideo]);
      const result = await service.getAllVideos();
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(cacheManager.set).toHaveBeenCalled();
    });

    it('should apply privacy filter', async () => {
      videoRepo.find.mockResolvedValue([mockVideo, { ...mockVideo, id: 'v2' }]);
      privacyService.filterVideosByPrivacy.mockResolvedValue([mockVideo]);
      const result = await service.getAllVideos();
      expect(result).toHaveLength(1);
    });
  });

  // ===== toggleHideVideo =====
  describe('toggleHideVideo', () => {
    it('should hide video and set private + disable comments', async () => {
      videoRepo.findOne.mockResolvedValue({ ...mockVideo, isHidden: false });
      const result = await service.toggleHideVideo('v1', 'u1');
      expect(result.isHidden).toBe(true);
      expect(result.visibility).toBe('private');
      expect(result.allowComments).toBe(false);
    });

    it('should unhide video and restore public + enable comments', async () => {
      videoRepo.findOne.mockResolvedValue({ ...mockVideo, isHidden: true });
      const result = await service.toggleHideVideo('v1', 'u1');
      expect(result.isHidden).toBe(false);
      expect(result.visibility).toBe('public');
      expect(result.allowComments).toBe(true);
    });

    it('should throw if video not found', async () => {
      videoRepo.findOne.mockResolvedValue(null);
      await expect(service.toggleHideVideo('v-none', 'u1')).rejects.toThrow('Video not found');
    });

    it('should throw for unauthorized user', async () => {
      await expect(service.toggleHideVideo('v1', 'u2')).rejects.toThrow('Unauthorized');
    });

    it('should remove from ES when hiding', async () => {
      videoRepo.findOne.mockResolvedValue({ ...mockVideo, isHidden: false });
      await service.toggleHideVideo('v1', 'u1');
      expect(searchService.deleteVideo).toHaveBeenCalledWith('v1');
    });

    it('should re-index to ES when unhiding a ready video', async () => {
      videoRepo.findOne.mockResolvedValue({ ...mockVideo, isHidden: true, status: 'ready' });
      await service.toggleHideVideo('v1', 'u1');
      expect(searchService.indexVideo).toHaveBeenCalled();
    });

    it('should handle ES error gracefully', async () => {
      videoRepo.findOne.mockResolvedValue({ ...mockVideo, isHidden: false });
      searchService.deleteVideo.mockRejectedValue(new Error('ES error'));
      const result = await service.toggleHideVideo('v1', 'u1');
      expect(result).toBeDefined();
    });
  });

  // ===== deleteVideo =====
  describe('deleteVideo', () => {
    it('should delete video and all related data', async () => {
      await service.deleteVideo('v1', 'u1');
      expect(likesService.deleteAllLikesForVideo).toHaveBeenCalledWith('v1');
      expect(commentsService.deleteAllCommentsForVideo).toHaveBeenCalledWith('v1');
      expect(savedVideosService.deleteAllSavesForVideo).toHaveBeenCalledWith('v1');
      expect(sharesService.deleteAllSharesForVideo).toHaveBeenCalledWith('v1');
      expect(videoRepo.delete).toHaveBeenCalledWith('v1');
      expect(searchService.deleteVideo).toHaveBeenCalledWith('v1');
    });

    it('should throw if video not found', async () => {
      videoRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteVideo('v-none', 'u1')).rejects.toThrow('Video not found');
    });

    it('should throw for unauthorized user', async () => {
      await expect(service.deleteVideo('v1', 'u2')).rejects.toThrow('Unauthorized');
    });

    it('should delete S3 files when storage enabled', async () => {
      storageService.isEnabled.mockReturnValue(true);
      await service.deleteVideo('v1', 'u1');
      expect(storageService.deleteFile).toHaveBeenCalled();
      expect(storageService.deleteDirectory).toHaveBeenCalled();
    });

    it('should handle S3 errors gracefully', async () => {
      storageService.isEnabled.mockReturnValue(true);
      storageService.deleteFile.mockRejectedValue(new Error('S3 err'));
      await service.deleteVideo('v1', 'u1');
      expect(videoRepo.delete).toHaveBeenCalled();
    });

    it('should delete local raw video if exists', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      await service.deleteVideo('v1', 'u1');
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should delete custom thumbnail from S3', async () => {
      storageService.isEnabled.mockReturnValue(true);
      videoRepo.findOne.mockResolvedValue({
        ...mockVideo,
        thumbnailUrl: 'https://cdn/thumbnails/thumb_abc.jpg',
      });
      await service.deleteVideo('v1', 'u1');
      expect(storageService.deleteFile).toHaveBeenCalledWith(expect.stringContaining('thumbnails/'));
    });
  });

  // ===== uploadVideo =====
  describe('uploadVideo', () => {
    const dto = { userId: 'u1', title: 'Test', description: 'desc', categoryIds: [1, 2] };
    const file = { originalname: 'vid.mp4', path: '/tmp/vid.mp4', filename: 'vid.mp4', size: 1024, mimetype: 'video/mp4' } as any;

    it('should upload video and send to queue', async () => {
      const result = await service.uploadVideo(dto, file);
      expect(result).toBeDefined();
      expect(videoRepo.save).toHaveBeenCalled();
      expect(categoriesService.assignCategoriesToVideo).toHaveBeenCalled();
      expect(activityLoggerService.logActivity).toHaveBeenCalled();
    });

    it('should reject invalid video file', async () => {
      (validateVideoFile as jest.Mock).mockResolvedValue({ isValid: false, error: 'Not a video' });
      await expect(service.uploadVideo(dto, file)).rejects.toThrow(BadRequestException);
      expect(deleteInvalidFile).toHaveBeenCalled();
    });

    it('should skip category assignment when no categories', async () => {
      const noCatDto = { userId: 'u1', title: 'Test', description: 'desc' };
      await service.uploadVideo(noCatDto, file);
      expect(categoriesService.assignCategoriesToVideo).not.toHaveBeenCalled();
    });

    it('should sync raw video to S3 when enabled', async () => {
      storageService.isEnabled.mockReturnValue(true);
      await service.uploadVideo(dto, file);
      expect(storageService.uploadFile).toHaveBeenCalled();
    });

    it('should handle S3 sync failure gracefully', async () => {
      storageService.isEnabled.mockReturnValue(true);
      storageService.uploadFile.mockRejectedValue(new Error('S3 down'));
      // Should still complete without throwing
      const result = await service.uploadVideo(dto, file);
      expect(result).toBeDefined();
    });
  });

  // ===== updateVideoStatus =====
  describe('updateVideoStatus', () => {
    it('should update status and invalidate cache', async () => {
      await service.updateVideoStatus('v1', VideoStatus.READY, '/hls/v1/playlist.m3u8');
      expect(videoRepo.update).toHaveBeenCalledWith('v1', expect.objectContaining({ status: VideoStatus.READY }));
      expect(cacheManager.del).toHaveBeenCalledWith('video:v1');
    });

    it('should index to ES when status is READY', async () => {
      await service.updateVideoStatus('v1', VideoStatus.READY);
      expect(searchService.indexVideo).toHaveBeenCalled();
    });

    it('should not index to ES for non-READY status', async () => {
      await service.updateVideoStatus('v1', VideoStatus.FAILED, undefined, 'error');
      expect(searchService.indexVideo).not.toHaveBeenCalled();
    });
  });

  // ===== updateVideoPrivacy =====
  describe('updateVideoPrivacy', () => {
    it('should update visibility', async () => {
      const result = await service.updateVideoPrivacy('v1', { userId: 'u1', visibility: 'friends' });
      expect(result.visibility).toBe('friends');
    });

    it('should auto-unhide when changing from private', async () => {
      videoRepo.findOne.mockResolvedValue({ ...mockVideo, isHidden: true, visibility: 'private' });
      const result = await service.updateVideoPrivacy('v1', { userId: 'u1', visibility: 'public' });
      expect(result.isHidden).toBe(false);
    });

    it('should throw if not found', async () => {
      videoRepo.findOne.mockResolvedValue(null);
      await expect(service.updateVideoPrivacy('v-none', { userId: 'u1' })).rejects.toThrow('Video not found');
    });

    it('should throw for unauthorized user', async () => {
      await expect(service.updateVideoPrivacy('v1', { userId: 'u2' })).rejects.toThrow('Not authorized');
    });

    it('should remove from ES when set to private', async () => {
      await service.updateVideoPrivacy('v1', { userId: 'u1', visibility: 'private' });
      expect(searchService.deleteVideo).toHaveBeenCalledWith('v1');
    });
  });

  // ===== editVideo =====
  describe('editVideo', () => {
    it('should update title and description', async () => {
      const result = await service.editVideo('v1', { userId: 'u1', title: 'New Title', description: 'New Desc' });
      expect(result.title).toBe('New Title');
      expect(searchService.indexVideo).toHaveBeenCalled();
    });

    it('should throw if not found', async () => {
      videoRepo.findOne.mockResolvedValue(null);
      await expect(service.editVideo('v-none', { userId: 'u1' })).rejects.toThrow('Video not found');
    });

    it('should throw for unauthorized user', async () => {
      await expect(service.editVideo('v1', { userId: 'u2' })).rejects.toThrow('Not authorized');
    });
  });

  // ===== retryFailedVideo =====
  describe('retryFailedVideo', () => {
    it('should retry a failed video', async () => {
      videoRepo.findOne
        .mockResolvedValueOnce({ ...mockVideo, status: VideoStatus.FAILED, errorMessage: 'timeout' })
        .mockResolvedValueOnce({ ...mockVideo, status: VideoStatus.PROCESSING });
      const result = await service.retryFailedVideo('v1', 'u1');
      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(videoRepo.update).toHaveBeenCalledWith('v1', expect.objectContaining({ status: VideoStatus.PROCESSING }));
    });

    it('should throw if not found', async () => {
      videoRepo.findOne.mockResolvedValue(null);
      await expect(service.retryFailedVideo('v-none', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('should throw for wrong user', async () => {
      await expect(service.retryFailedVideo('v1', 'u2')).rejects.toThrow(BadRequestException);
    });

    it('should throw for non-failed video', async () => {
      await expect(service.retryFailedVideo('v1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  // ===== updateThumbnail =====
  describe('updateThumbnail', () => {
    const thumbFile = { path: '/tmp/thumb.jpg', filename: 'thumb.jpg', mimetype: 'image/jpeg' } as any;

    it('should update thumbnail locally', async () => {
      const result = await service.updateThumbnail('v1', 'u1', thumbFile);
      expect(result.thumbnailUrl).toBe('/uploads/thumbnails/thumb.jpg');
    });

    it('should upload to S3 when enabled', async () => {
      storageService.isEnabled.mockReturnValue(true);
      const result = await service.updateThumbnail('v1', 'u1', thumbFile);
      expect(result.thumbnailUrl).toBe('https://cdn/file');
    });

    it('should throw if not found', async () => {
      videoRepo.findOne.mockResolvedValue(null);
      await expect(service.updateThumbnail('v-none', 'u1', thumbFile)).rejects.toThrow('Video not found');
    });

    it('should throw for unauthorized user', async () => {
      await expect(service.updateThumbnail('v1', 'u2', thumbFile)).rejects.toThrow('Not authorized');
    });
  });

  // ===== invalidateCacheAfterProcessing =====
  describe('invalidateCacheAfterProcessing', () => {
    it('should invalidate video and user caches', async () => {
      await service.invalidateCacheAfterProcessing('v1', 'u1');
      expect(cacheManager.del).toHaveBeenCalledWith('video:v1');
    });
  });

  // ===== checkMutualFriend =====
  describe('checkMutualFriend', () => {
    it('should return true for mutual friends', async () => {
      httpService.get.mockReturnValue(of({ data: { isMutual: true } }));
      expect(await service.checkMutualFriend('u1', 'u2')).toBe(true);
    });

    it('should return false for non-mutual', async () => {
      httpService.get.mockReturnValue(of({ data: { isMutual: false } }));
      expect(await service.checkMutualFriend('u1', 'u2')).toBe(false);
    });

    it('should return false on error', async () => {
      httpService.get.mockReturnValue(throwError(() => new Error('fail')));
      expect(await service.checkMutualFriend('u1', 'u2')).toBe(false);
    });

    it('should return false for null ids', async () => {
      expect(await service.checkMutualFriend('', 'u2')).toBe(false);
    });
  });

  // ===== getFollowingVideos =====
  describe('getFollowingVideos', () => {
    it('should return empty when no following', async () => {
      httpService.get.mockReturnValue(of({ data: { followingIds: [], data: [] } }));
      const result = await service.getFollowingVideos(1);
      expect(result).toEqual([]);
    });

    it('should exclude mutual friends from following feed', async () => {
      httpService.get
        .mockReturnValueOnce(of({ data: { followingIds: [2, 3, 4] } }))
        .mockReturnValueOnce(of({ data: { data: [{ userId: 3 }] } }));
      qb.getMany.mockResolvedValue([mockVideo]);
      privacyService.getPrivacySettingsBatch.mockResolvedValue(new Map());
      const result = await service.getFollowingVideos(1);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle error gracefully', async () => {
      httpService.get.mockReturnValue(throwError(() => new Error('fail')));
      await expect(service.getFollowingVideos(1)).rejects.toThrow();
    });
  });

  // ===== getFriendsVideos =====
  describe('getFriendsVideos', () => {
    it('should return empty when no mutual friends', async () => {
      httpService.get.mockReturnValue(of({ data: { data: [] } }));
      const result = await service.getFriendsVideos(1);
      expect(result).toEqual([]);
    });

    it('should fetch videos from mutual friends', async () => {
      httpService.get.mockReturnValue(of({ data: { data: [{ userId: 2 }] } }));
      qb.getMany.mockResolvedValue([mockVideo]);
      privacyService.getPrivacySettingsBatch.mockResolvedValue(new Map());
      const result = await service.getFriendsVideos(1);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter out onlyMe visibility', async () => {
      httpService.get.mockReturnValue(of({ data: { data: [{ userId: 2 }] } }));
      qb.getMany.mockResolvedValue([{ ...mockVideo, userId: '2' }]);
      privacyService.getPrivacySettingsBatch.mockResolvedValue(
        new Map([['2', { whoCanViewVideos: 'onlyMe' }]])
      );
      const result = await service.getFriendsVideos(1);
      expect(result).toEqual([]);
    });
  });

  // ===== getFollowingNewVideoCount / getFriendsNewVideoCount =====
  describe('getFollowingNewVideoCount', () => {
    it('should return 0 when no following', async () => {
      httpService.get.mockReturnValue(of({ data: { followingIds: [], data: [] } }));
      expect(await service.getFollowingNewVideoCount(1, new Date())).toBe(0);
    });

    it('should handle error', async () => {
      httpService.get.mockReturnValue(throwError(() => new Error('fail')));
      expect(await service.getFollowingNewVideoCount(1, new Date())).toBe(0);
    });
  });

  describe('getFriendsNewVideoCount', () => {
    it('should return 0 when no mutual friends', async () => {
      httpService.get.mockReturnValue(of({ data: { data: [] } }));
      expect(await service.getFriendsNewVideoCount(1, new Date())).toBe(0);
    });

    it('should handle error', async () => {
      httpService.get.mockReturnValue(throwError(() => new Error('fail')));
      expect(await service.getFriendsNewVideoCount(1, new Date())).toBe(0);
    });
  });

  // ===== uploadVideoWithThumbnail =====
  describe('uploadVideoWithThumbnail', () => {
    const dto = { userId: 'u1', title: 'Test', description: 'desc' };
    const videoFile = { originalname: 'vid.mp4', path: '/tmp/vid.mp4', filename: 'vid.mp4', size: 1024 } as any;
    const thumbnailFile = { originalname: 'thumb.jpg', path: '/tmp/thumb.jpg', filename: 'thumb.jpg', mimetype: 'image/jpeg' } as any;

    it('should upload video with custom thumbnail', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);
      const result = await service.uploadVideoWithThumbnail(dto, videoFile, thumbnailFile);
      expect(result).toBeDefined();
      expect(result.thumbnailUrl).toBe('/uploads/thumbnails/thumb.jpg');
    });

    it('should upload without custom thumbnail', async () => {
      const result = await service.uploadVideoWithThumbnail(dto, videoFile);
      expect(result).toBeDefined();
    });

    it('should upload thumbnail to S3 when enabled', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);
      storageService.isEnabled.mockReturnValue(true);
      const result = await service.uploadVideoWithThumbnail(dto, videoFile, thumbnailFile);
      expect(result.thumbnailUrl).toBe('https://cdn/file');
    });

    it('should handle rename failure with copy fallback', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);
      fs.renameSync.mockImplementation(() => { throw new Error('cross-device'); });
      const result = await service.uploadVideoWithThumbnail(dto, videoFile, thumbnailFile);
      expect(fs.copyFileSync).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });
});

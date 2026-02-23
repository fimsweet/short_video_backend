import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { ChunkedUploadService } from './chunked-upload.service';

describe('VideosController', () => {
  let controller: VideosController;
  let videosService: any;
  let chunkedUploadService: any;

  beforeEach(async () => {
    videosService = {
      uploadVideo: jest.fn().mockResolvedValue({ id: 'v1', status: 'processing' }),
      searchVideos: jest.fn().mockResolvedValue([]),
      getVideosByUserId: jest.fn().mockResolvedValue({ videos: [], privacyRestricted: false }),
      getAllVideos: jest.fn().mockResolvedValue([]),
      getFollowingVideos: jest.fn().mockResolvedValue([]),
      getFriendsVideos: jest.fn().mockResolvedValue([]),
      getFollowingNewVideoCount: jest.fn().mockResolvedValue(5),
      getFriendsNewVideoCount: jest.fn().mockResolvedValue(3),
      getVideoById: jest.fn().mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: false, visibility: 'public' }),
      incrementViewCount: jest.fn().mockResolvedValue({ viewCount: 101 }),
      toggleHideVideo: jest.fn().mockResolvedValue({ isHidden: true, visibility: 'public', allowComments: true }),
      deleteVideo: jest.fn().mockResolvedValue(undefined),
      updateVideoPrivacy: jest.fn().mockResolvedValue({ isHidden: false, visibility: 'friends', allowComments: true, allowDuet: false }),
      editVideo: jest.fn().mockResolvedValue({ id: 'v1', title: 'New', description: 'desc' }),
      updateThumbnail: jest.fn().mockResolvedValue({ thumbnailUrl: '/thumb.jpg' }),
      uploadVideoWithThumbnail: jest.fn().mockResolvedValue({ id: 'v1', status: 'processing' }),
      invalidateCacheAfterProcessing: jest.fn().mockResolvedValue(undefined),
      retryFailedVideo: jest.fn().mockResolvedValue({ id: 'v1', status: 'processing' }),
      checkMutualFriend: jest.fn().mockResolvedValue(false),
    };
    chunkedUploadService = {
      initUpload: jest.fn().mockReturnValue('upload-123'),
      uploadChunk: jest.fn().mockResolvedValue({ uploadedChunks: 1, totalChunks: 5 }),
      completeUpload: jest.fn().mockResolvedValue({ filePath: '/tmp/video.mp4', fileName: 'video.mp4', metadata: { userId: 'u1', title: 'test', description: '' } }),
      getUploadStatus: jest.fn().mockReturnValue({ uploadedChunks: 3, totalChunks: 5 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideosController],
      providers: [
        { provide: VideosService, useValue: videosService },
        { provide: ChunkedUploadService, useValue: chunkedUploadService },
      ],
    }).compile();

    controller = module.get<VideosController>(VideosController);
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });

  describe('uploadVideo', () => {
    it('should accept file and return videoId', async () => {
      const result = await controller.uploadVideo({ filename: 'test.mp4' } as any, { userId: 'u1', title: 'Test' } as any);
      expect(result.videoId).toBe('v1');
    });
    it('should throw if no file', async () => {
      await expect(controller.uploadVideo(null as any, {} as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('searchVideos', () => {
    it('should return search results', async () => {
      const result = await controller.searchVideos('test');
      expect(result.success).toBe(true);
    });
  });

  describe('getUserVideos', () => {
    it('should return user videos', async () => {
      const result = await controller.getUserVideos('u1');
      expect(result.success).toBe(true);
    });
  });

  describe('getFeed', () => {
    it('should return feed', async () => {
      await controller.getFeed();
      expect(videosService.getAllVideos).toHaveBeenCalledWith(50);
    });
  });

  describe('getFollowingFeed', () => {
    it('should return following feed', async () => {
      await controller.getFollowingFeed('1');
      expect(videosService.getFollowingVideos).toHaveBeenCalledWith(1, 50);
    });
  });

  describe('getFriendsFeed', () => {
    it('should return friends feed', async () => {
      await controller.getFriendsFeed('1');
      expect(videosService.getFriendsVideos).toHaveBeenCalledWith(1, 50);
    });
  });

  describe('getFollowingNewCount', () => {
    it('should return new count', async () => {
      const result = await controller.getFollowingNewCount('1', '2025-01-01');
      expect(result.success).toBe(true);
      expect(result.newCount).toBe(5);
    });
    it('should use default date if not provided', async () => {
      await controller.getFollowingNewCount('1', '');
      expect(videosService.getFollowingNewVideoCount).toHaveBeenCalled();
    });
  });

  describe('getFriendsNewCount', () => {
    it('should return friends new count', async () => {
      const result = await controller.getFriendsNewCount('1', '2025-01-01');
      expect(result.newCount).toBe(3);
    });
  });

  describe('getVideo', () => {
    it('should return video', async () => {
      const result = await controller.getVideo('v1');
      expect(result).toBeDefined();
    });
    it('should return null if video is null', async () => {
      videosService.getVideoById.mockResolvedValue(null);
      const result = await controller.getVideo('v1');
      expect(result).toBeNull();
    });
    it('should return null for hidden video if not owner', async () => {
      videosService.getVideoById.mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: true, visibility: 'public' });
      const result = await controller.getVideo('v1', 'u2');
      expect(result).toBeNull();
    });
    it('should return hidden video for owner', async () => {
      videosService.getVideoById.mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: true, visibility: 'public' });
      const result = await controller.getVideo('v1', 'u1');
      expect(result).toBeDefined();
    });
    it('should return null for private video if not owner', async () => {
      videosService.getVideoById.mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: false, visibility: 'private' });
      const result = await controller.getVideo('v1', 'u2');
      expect(result).toBeNull();
    });
    it('should block friends-only video for non-friend', async () => {
      videosService.getVideoById.mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: false, visibility: 'friends' });
      videosService.checkMutualFriend.mockResolvedValue(false);
      const result = await controller.getVideo('v1', 'u2');
      expect(result).toBeNull();
    });
    it('should allow friends-only video for friend', async () => {
      const video = { id: 'v1', userId: 'u1', isHidden: false, visibility: 'friends' };
      videosService.getVideoById.mockResolvedValue(video);
      videosService.checkMutualFriend.mockResolvedValue(true);
      const result = await controller.getVideo('v1', 'u2');
      expect(result).toEqual(video);
    });
    it('should block friends-only video on friendship check error', async () => {
      videosService.getVideoById.mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: false, visibility: 'friends' });
      videosService.checkMutualFriend.mockRejectedValue(new Error('fail'));
      const result = await controller.getVideo('v1', 'u2');
      expect(result).toBeNull();
    });
  });

  describe('incrementViewCount', () => {
    it('should increment view', async () => {
      const result = await controller.incrementViewCount('v1');
      expect(result.viewCount).toBe(101);
    });
  });

  describe('toggleHideVideo', () => {
    it('should toggle hide', async () => {
      const result = await controller.toggleHideVideo('v1', 'u1');
      expect(result.success).toBe(true);
      expect(result.isHidden).toBe(true);
    });
  });

  describe('deleteVideo', () => {
    it('should delete video', async () => {
      const result = await controller.deleteVideo('v1', 'u1');
      expect(result.success).toBe(true);
    });
  });

  describe('updateVideoPrivacy', () => {
    it('should update privacy', async () => {
      const result = await controller.updateVideoPrivacy('v1', { userId: 'u1', visibility: 'friends' });
      expect(result.success).toBe(true);
    });
  });

  describe('editVideo', () => {
    it('should edit video', async () => {
      const result = await controller.editVideo('v1', { userId: 'u1', title: 'New' });
      expect(result.success).toBe(true);
      expect(result.video.title).toBe('New');
    });
  });

  describe('updateThumbnail', () => {
    it('should update thumbnail', async () => {
      const result = await controller.updateThumbnail('v1', { filename: 'thumb.jpg' } as any, 'u1');
      expect(result.success).toBe(true);
    });
    it('should throw if no file', async () => {
      await expect(controller.updateThumbnail('v1', null as any, 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('uploadVideoWithThumbnail', () => {
    it('should upload video with thumbnail', async () => {
      const result = await controller.uploadVideoWithThumbnail(
        { video: [{ filename: 'test.mp4' } as any], thumbnail: [{ filename: 'thumb.jpg' } as any] },
        { userId: 'u1' } as any,
      );
      expect(result.hasCustomThumbnail).toBe(true);
    });
    it('should throw if no video file', async () => {
      await expect(controller.uploadVideoWithThumbnail({ video: [] } as any, {} as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('onProcessingComplete', () => {
    it('should invalidate cache', async () => {
      const result = await controller.onProcessingComplete('v1', 'u1');
      expect(result.success).toBe(true);
    });
  });

  describe('retryVideo', () => {
    it('should retry video', async () => {
      const result = await controller.retryVideo('v1', 'u1');
      expect(result.success).toBe(true);
    });
    it('should throw if no userId', async () => {
      await expect(controller.retryVideo('v1', '')).rejects.toThrow(BadRequestException);
    });
  });

  describe('testThumbnail', () => {
    it('should return thumbnail info', async () => {
      const result = await controller.testThumbnail('v1');
      expect(result.videoId).toBe('v1');
    });
  });

  describe('chunked upload', () => {
    it('should init chunked upload', async () => {
      const result = await controller.initChunkedUpload({ fileName: 'v.mp4', fileSize: 1000, totalChunks: 5, userId: 'u1', title: 'T', description: '' });
      expect(result.uploadId).toBe('upload-123');
    });
    it('should upload chunk', async () => {
      const result = await controller.uploadChunk({ buffer: Buffer.from('data') } as any, { uploadId: 'upload-123', chunkIndex: '0' as any });
      expect(result.success).toBe(true);
    });
    it('should throw if no chunk file', async () => {
      await expect(controller.uploadChunk(null as any, {} as any)).rejects.toThrow(BadRequestException);
    });
    it('should complete chunked upload', async () => {
      const result = await controller.completeChunkedUpload({ uploadId: 'upload-123' });
      expect(result.success).toBe(true);
    });
    it('should get upload status', async () => {
      const result = await controller.getChunkedUploadStatus('upload-123');
      expect(result.success).toBe(true);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SavedVideosService } from './saved-videos.service';
import { SavedVideo } from '../entities/saved-video.entity';
import { VideosService } from '../videos/videos.service';

describe('SavedVideosService', () => {
  let service: SavedVideosService;
  let savedVideoRepo: any;
  let videosService: any;

  beforeEach(async () => {
    savedVideoRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue({ id: 1 }),
      remove: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(5),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    videosService = {
      getVideoById: jest.fn().mockResolvedValue({ id: 'v1', likeCount: 10, commentCount: 5, thumbnailUrl: 'thumb.jpg', isHidden: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedVideosService,
        { provide: getRepositoryToken(SavedVideo), useValue: savedVideoRepo },
        { provide: VideosService, useValue: videosService },
      ],
    }).compile();
    service = module.get<SavedVideosService>(SavedVideosService);
    // Manually inject forwardRef dependency
    (service as any).videosService = videosService;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('toggleSave', () => {
    it('should save a video when not already saved', async () => {
      savedVideoRepo.findOne.mockResolvedValue(null);
      const result = await service.toggleSave('v1', 'u1');
      expect(result.saved).toBe(true);
      expect(result.saveCount).toBe(5);
      expect(savedVideoRepo.save).toHaveBeenCalledWith({ videoId: 'v1', userId: 'u1' });
    });

    it('should unsave a video when already saved', async () => {
      savedVideoRepo.findOne.mockResolvedValue({ id: 1, videoId: 'v1', userId: 'u1' });
      const result = await service.toggleSave('v1', 'u1');
      expect(result.saved).toBe(false);
      expect(result.saveCount).toBe(5);
      expect(savedVideoRepo.remove).toHaveBeenCalled();
    });
  });

  describe('getSaveCount', () => {
    it('should return save count', async () => {
      const count = await service.getSaveCount('v1');
      expect(count).toBe(5);
    });
  });

  describe('isSavedByUser', () => {
    it('should return true if saved', async () => {
      savedVideoRepo.findOne.mockResolvedValue({ id: 1 });
      expect(await service.isSavedByUser('v1', 'u1')).toBe(true);
    });

    it('should return false if not saved', async () => {
      savedVideoRepo.findOne.mockResolvedValue(null);
      expect(await service.isSavedByUser('v1', 'u1')).toBe(false);
    });
  });

  describe('getSavedVideos', () => {
    it('should return saved videos with details', async () => {
      savedVideoRepo.find.mockResolvedValue([
        { videoId: 'v1', createdAt: new Date() },
        { videoId: 'v2', createdAt: new Date() },
      ]);
      videosService.getVideoById
        .mockResolvedValueOnce({ id: 'v1', isHidden: false, likeCount: 5, commentCount: 2, thumbnailUrl: 'a.jpg' })
        .mockResolvedValueOnce({ id: 'v2', isHidden: false, likeCount: 3, commentCount: 1, thumbnailUrl: 'b.jpg' });

      const result = await service.getSavedVideos('u1');
      expect(result).toHaveLength(2);
    });

    it('should filter out null and hidden videos', async () => {
      savedVideoRepo.find.mockResolvedValue([
        { videoId: 'v1', createdAt: new Date() },
        { videoId: 'v2', createdAt: new Date() },
        { videoId: 'v3', createdAt: new Date() },
      ]);
      videosService.getVideoById
        .mockResolvedValueOnce({ id: 'v1', isHidden: false })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'v3', isHidden: true });

      const result = await service.getSavedVideos('u1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('v1');
    });

    it('should return empty array when no saved videos', async () => {
      savedVideoRepo.find.mockResolvedValue([]);
      const result = await service.getSavedVideos('u1');
      expect(result).toHaveLength(0);
    });
  });

  describe('deleteAllSavesForVideo', () => {
    it('should delete all saves', async () => {
      await service.deleteAllSavesForVideo('v1');
      expect(savedVideoRepo.delete).toHaveBeenCalledWith({ videoId: 'v1' });
    });
  });
});

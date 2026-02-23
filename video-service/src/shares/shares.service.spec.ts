import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SharesService } from './shares.service';
import { Share } from '../entities/share.entity';
import { Video } from '../entities/video.entity';

describe('SharesService', () => {
  let service: SharesService;
  let shareRepo: any;
  let videoRepo: any;

  beforeEach(async () => {
    shareRepo = {
      save: jest.fn().mockResolvedValue({ id: 1 }),
      count: jest.fn().mockResolvedValue(3),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    videoRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: false, visibility: 'public' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharesService,
        { provide: getRepositoryToken(Share), useValue: shareRepo },
        { provide: getRepositoryToken(Video), useValue: videoRepo },
      ],
    }).compile();
    service = module.get<SharesService>(SharesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createShare', () => {
    it('should create a share and return count', async () => {
      const result = await service.createShare('v1', 'u2', 'u3');
      expect(shareRepo.save).toHaveBeenCalledWith({ videoId: 'v1', sharerId: 'u2', recipientId: 'u3' });
      expect(result.shareCount).toBe(3);
    });

    it('should throw if sharing a hidden video by non-owner', async () => {
      videoRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: true, visibility: 'public' });
      await expect(service.createShare('v1', 'u2', 'u3')).rejects.toThrow('Cannot share a hidden video');
    });

    it('should allow owner to share their own hidden video', async () => {
      videoRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: true, visibility: 'public' });
      const result = await service.createShare('v1', 'u1', 'u3');
      expect(result.shareCount).toBe(3);
    });

    it('should throw if sharing a private video by non-owner', async () => {
      videoRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: false, visibility: 'private' });
      await expect(service.createShare('v1', 'u2', 'u3')).rejects.toThrow('Cannot share a private video');
    });

    it('should allow owner to share their own private video', async () => {
      videoRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', isHidden: false, visibility: 'private' });
      const result = await service.createShare('v1', 'u1', 'u3');
      expect(result.shareCount).toBe(3);
    });

    it('should handle video not found (null)', async () => {
      videoRepo.findOne.mockResolvedValue(null);
      const result = await service.createShare('v1', 'u2', 'u3');
      expect(result.shareCount).toBe(3);
    });
  });

  describe('getShareCount', () => {
    it('should return share count', async () => {
      const count = await service.getShareCount('v1');
      expect(count).toBe(3);
      expect(shareRepo.count).toHaveBeenCalledWith({ where: { videoId: 'v1' } });
    });
  });

  describe('getSharesByVideo', () => {
    it('should return shares', async () => {
      shareRepo.find.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await service.getSharesByVideo('v1');
      expect(result).toHaveLength(2);
      expect(shareRepo.find).toHaveBeenCalledWith({ where: { videoId: 'v1' }, order: { createdAt: 'DESC' } });
    });
  });

  describe('deleteAllSharesForVideo', () => {
    it('should delete all shares', async () => {
      await service.deleteAllSharesForVideo('v1');
      expect(shareRepo.delete).toHaveBeenCalledWith({ videoId: 'v1' });
    });
  });
});

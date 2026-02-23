import { Test, TestingModule } from '@nestjs/testing';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

describe('LikesController', () => {
  let controller: LikesController;
  let service: any;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    service = {
      toggleLike: jest.fn().mockResolvedValue({ liked: true, likeCount: 11 }),
      getLikeCount: jest.fn().mockResolvedValue(10),
      isLikedByUser: jest.fn().mockResolvedValue(true),
      getLikesByVideo: jest.fn().mockResolvedValue([]),
      getLikedVideosByUser: jest.fn().mockResolvedValue([]),
      getTotalReceivedLikes: jest.fn().mockResolvedValue(100),
      getUsersWithSimilarTaste: jest.fn().mockResolvedValue([]),
      getCreatorsOfLikedVideos: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LikesController],
      providers: [{ provide: LikesService, useValue: service }],
    }).compile();

    controller = module.get<LikesController>(LikesController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should toggle like', async () => {
    const result = await controller.toggleLike({ videoId: 'v1', userId: 'u1' });
    expect(result.liked).toBe(true);
  });

  it('should get like count', async () => {
    const result = await controller.getLikeCount('v1');
    expect(result.count).toBe(10);
  });

  it('should check like', async () => {
    const result = await controller.checkLike('v1', 'u1');
    expect(result.liked).toBe(true);
  });

  it('should get likes by video', async () => {
    await controller.getLikesByVideo('v1');
    expect(service.getLikesByVideo).toHaveBeenCalledWith('v1');
  });

  it('should get liked videos by user', async () => {
    await controller.getLikedVideosByUser('u1');
    expect(service.getLikedVideosByUser).toHaveBeenCalledWith('u1');
  });

  it('should get total received likes', async () => {
    const result = await controller.getTotalReceivedLikes('u1');
    expect(result.count).toBe(100);
  });

  it('should get similar users', async () => {
    await controller.getUsersWithSimilarTaste('u1', '2,3', '10');
    expect(service.getUsersWithSimilarTaste).toHaveBeenCalledWith('u1', [2, 3], 10);
  });

  it('should get similar users without excludeIds', async () => {
    await controller.getUsersWithSimilarTaste('u1');
    expect(service.getUsersWithSimilarTaste).toHaveBeenCalledWith('u1', [], 20);
  });

  it('should get creators of liked videos', async () => {
    await controller.getCreatorsOfLikedVideos('u1', '2', '5');
    expect(service.getCreatorsOfLikedVideos).toHaveBeenCalledWith('u1', [2], 5);
  });
});

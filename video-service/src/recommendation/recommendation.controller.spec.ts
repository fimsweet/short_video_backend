import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';

describe('RecommendationController', () => {
  let controller: RecommendationController;
  let service: any;

  beforeEach(async () => {
    service = {
      getRecommendedVideos: jest.fn().mockResolvedValue([{ id: 'v1' }]),
      getTrendingVideos: jest.fn().mockResolvedValue([{ id: 'v2' }]),
      getVideosByCategory: jest.fn().mockResolvedValue([]),
      invalidateUserCache: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationController],
      providers: [{ provide: RecommendationService, useValue: service }],
    }).compile();

    controller = module.get<RecommendationController>(RecommendationController);
  });

  it('should get for-you feed', async () => {
    const result = await controller.getForYouFeed(1, 50, 'v1,v2');
    expect(result.success).toBe(true);
    expect(service.getRecommendedVideos).toHaveBeenCalledWith(1, 50, ['v1', 'v2']);
  });

  it('should get for-you feed without excludeIds', async () => {
    const result = await controller.getForYouFeed(1, 50);
    expect(service.getRecommendedVideos).toHaveBeenCalledWith(1, 50, []);
  });

  it('should get trending', async () => {
    const result = await controller.getTrendingVideos(50);
    expect(result.success).toBe(true);
  });

  it('should get by category', async () => {
    const result = await controller.getVideosByCategory(1, 50);
    expect(result.success).toBe(true);
  });

  it('should invalidate cache', async () => {
    const result = await controller.invalidateCache(1);
    expect(result.success).toBe(true);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: any;

  beforeEach(async () => {
    service = {
      getUserAnalytics: jest.fn().mockResolvedValue({ totalViews: 100 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: service }],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
  });

  it('should return user analytics', async () => {
    const result = await controller.getUserAnalytics('u1');
    expect(result.totalViews).toBe(100);
  });
});

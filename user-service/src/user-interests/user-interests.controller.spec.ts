import { Test, TestingModule } from '@nestjs/testing';
import { UserInterestsController } from './user-interests.controller';
import { UserInterestsService } from './user-interests.service';

describe('UserInterestsController', () => {
  let controller: UserInterestsController;
  let service: jest.Mocked<Partial<UserInterestsService>>;

  beforeEach(async () => {
    service = {
      getAvailableCategories: jest.fn().mockResolvedValue([
        { id: 1, name: 'music', displayName: 'Music' },
      ]),
      getUserInterests: jest.fn().mockResolvedValue([
        { id: 1, userId: 1, categoryId: 1, weight: 1.0 },
      ]),
      hasSelectedInterests: jest.fn().mockResolvedValue(true),
      setUserInterests: jest.fn().mockResolvedValue([{ id: 1 }]),
      addUserInterests: jest.fn().mockResolvedValue([{ id: 2 }]),
      removeUserInterest: jest.fn().mockResolvedValue(true),
      getInterestStats: jest.fn().mockResolvedValue({ total: 2, categories: ['Music'] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserInterestsController],
      providers: [
        { provide: UserInterestsService, useValue: service },
      ],
    }).compile();

    controller = module.get<UserInterestsController>(UserInterestsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAvailableCategories', () => {
    it('should return categories', async () => {
      const result = await controller.getAvailableCategories();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getUserInterests', () => {
    it('should return user interests', async () => {
      const result = await controller.getUserInterests(1);
      expect(result.success).toBe(true);
    });
  });

  describe('hasSelectedInterests', () => {
    it('should check if user has interests', async () => {
      const result = await controller.hasSelectedInterests(1);
      expect(result.success).toBe(true);
      expect(result.hasInterests).toBe(true);
    });
  });

  describe('setUserInterests', () => {
    it('should set user interests with 3+ categories', async () => {
      const result = await controller.setUserInterests(1, { categoryIds: [1, 2, 3] });
      expect(result.success).toBe(true);
    });

    it('should reject if less than 3 categories', async () => {
      const result = await controller.setUserInterests(1, { categoryIds: [1] });
      expect(result.success).toBe(false);
    });

    it('should handle service errors', async () => {
      (service.setUserInterests as jest.Mock).mockRejectedValue(new Error('User not found'));
      const result = await controller.setUserInterests(1, { categoryIds: [1, 2, 3] });
      expect(result.success).toBe(false);
    });
  });

  describe('addUserInterests', () => {
    it('should add interests', async () => {
      const result = await controller.addUserInterests(1, { categoryIds: [2] });
      expect(result.success).toBe(true);
    });
  });

  describe('removeUserInterest', () => {
    it('should remove an interest', async () => {
      const result = await controller.removeUserInterest(1, 2);
      expect(result.success).toBe(true);
    });
  });

  describe('getInterestStats', () => {
    it('should return stats', async () => {
      const result = await controller.getInterestStats(1);
      expect(result.success).toBe(true);
      expect(result.data.total).toBe(2);
    });
  });
});

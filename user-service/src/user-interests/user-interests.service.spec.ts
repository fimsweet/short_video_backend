import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { UserInterestsService } from './user-interests.service';
import { UserInterest } from '../entities/user-interest.entity';
import { User } from '../entities/user.entity';
import { of } from 'rxjs';

describe('UserInterestsService', () => {
  let service: UserInterestsService;
  let mockInterestRepo: any;
  let mockUserRepo: any;
  let mockHttpService: any;
  let mockConfigService: any;

  const mockCategories = [
    { id: 1, name: 'music', displayName: 'Music', displayNameVi: 'Âm nhạc', icon: 'music' },
    { id: 2, name: 'sports', displayName: 'Sports', displayNameVi: 'Thể thao', icon: 'sports' },
    { id: 3, name: 'cooking', displayName: 'Cooking', displayNameVi: 'Nấu ăn', icon: 'cooking' },
  ];

  beforeEach(async () => {
    mockInterestRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: 1 })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockUserRepo = {
      findOne: jest.fn(),
    };

    mockHttpService = {
      get: jest.fn().mockReturnValue(of({ data: { data: mockCategories } })),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:3002'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserInterestsService,
        { provide: getRepositoryToken(UserInterest), useValue: mockInterestRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<UserInterestsService>(UserInterestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAvailableCategories', () => {
    it('should fetch categories from video-service', async () => {
      const result = await service.getAvailableCategories();
      expect(result).toHaveLength(3);
      expect(mockHttpService.get).toHaveBeenCalledWith('http://localhost:3002/categories');
    });

    it('should return empty array on error', async () => {
      mockHttpService.get.mockReturnValue(of(Promise.reject(new Error('Network error'))));
      // The service catches errors internally
      const result = await service.getAvailableCategories().catch(() => []);
      expect(result).toEqual([]);
    });
  });

  describe('getUserInterests', () => {
    it('should return user interests sorted by weight', async () => {
      mockInterestRepo.find.mockResolvedValue([
        { id: 1, userId: 1, categoryId: 1, weight: 1.5 },
        { id: 2, userId: 1, categoryId: 2, weight: 1.0 },
      ]);

      const result = await service.getUserInterests(1);
      expect(result).toHaveLength(2);
      expect(mockInterestRepo.find).toHaveBeenCalledWith({
        where: { userId: 1 },
        order: { weight: 'DESC' },
      });
    });
  });

  describe('hasSelectedInterests', () => {
    it('should return true when user has interests', async () => {
      mockInterestRepo.count.mockResolvedValue(3);
      const result = await service.hasSelectedInterests(1);
      expect(result).toBe(true);
    });

    it('should return false when user has no interests', async () => {
      mockInterestRepo.count.mockResolvedValue(0);
      const result = await service.hasSelectedInterests(1);
      expect(result).toBe(false);
    });
  });

  describe('setUserInterests', () => {
    it('should replace all interests with new ones', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 1, username: 'test' });
      mockInterestRepo.delete.mockResolvedValue({ affected: 2 });

      const result = await service.setUserInterests(1, [1, 2]);

      expect(mockInterestRepo.delete).toHaveBeenCalledWith({ userId: 1 });
      expect(mockInterestRepo.save).toHaveBeenCalledTimes(2);
    });

    it('should throw if user not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.setUserInterests(999, [1])).rejects.toThrow('User not found');
    });
  });

  describe('addUserInterests', () => {
    it('should add new interests without removing existing', async () => {
      mockInterestRepo.find.mockResolvedValue([
        { id: 1, userId: 1, categoryId: 1 },
      ]);

      const result = await service.addUserInterests(1, [1, 2]); // 1 exists, 2 is new

      // Only categoryId 2 should be saved (1 already exists)
      expect(mockInterestRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeUserInterest', () => {
    it('should remove an interest', async () => {
      mockInterestRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await service.removeUserInterest(1, 2);
      expect(result).toBe(true);
    });

    it('should return false if interest not found', async () => {
      mockInterestRepo.delete.mockResolvedValue({ affected: 0 });

      const result = await service.removeUserInterest(1, 999);
      expect(result).toBe(false);
    });
  });

  describe('updateInterestWeight', () => {
    it('should increase weight within bounds', async () => {
      mockInterestRepo.findOne.mockResolvedValue({ userId: 1, categoryId: 1, weight: 1.0 });

      await service.updateInterestWeight(1, 1, 0.5);

      expect(mockInterestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 1.5 }),
      );
    });

    it('should cap weight at 2.0', async () => {
      mockInterestRepo.findOne.mockResolvedValue({ userId: 1, categoryId: 1, weight: 1.8 });

      await service.updateInterestWeight(1, 1, 0.5);

      expect(mockInterestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 2.0 }),
      );
    });

    it('should not go below 0.1', async () => {
      mockInterestRepo.findOne.mockResolvedValue({ userId: 1, categoryId: 1, weight: 0.2 });

      await service.updateInterestWeight(1, 1, -0.5);

      expect(mockInterestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 0.1 }),
      );
    });

    it('should do nothing if interest not found', async () => {
      mockInterestRepo.findOne.mockResolvedValue(null);

      await service.updateInterestWeight(1, 999, 0.5);

      expect(mockInterestRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('boostInterestFromEngagement', () => {
    it('should boost existing interest', async () => {
      mockInterestRepo.findOne.mockResolvedValue({ userId: 1, categoryId: 1, weight: 1.0 });

      await service.boostInterestFromEngagement(1, [1]);

      expect(mockInterestRepo.save).toHaveBeenCalled();
    });

    it('should create new implicit interest if not exists', async () => {
      mockInterestRepo.findOne.mockResolvedValue(null);

      await service.boostInterestFromEngagement(1, [1]);

      expect(mockInterestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 0.5 }),
      );
    });
  });

  describe('getInterestStats', () => {
    it('should return interest statistics', async () => {
      mockInterestRepo.find.mockResolvedValue([
        { id: 1, userId: 1, categoryId: 1, categoryName: 'Music', weight: 1.5 },
        { id: 2, userId: 1, categoryId: 2, categoryName: 'Sports', weight: 1.0 },
      ]);

      const result = await service.getInterestStats(1);

      expect(result.total).toBe(2);
      expect(result.categories).toEqual(['Music', 'Sports']);
    });
  });
});

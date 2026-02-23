import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CategoriesService } from './categories.service';
import { Category } from '../entities/category.entity';
import { VideoCategory } from '../entities/video-category.entity';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let categoryRepo: any;
  let videoCategoryRepo: any;

  beforeEach(async () => {
    categoryRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 1, name: 'entertainment', displayName: 'Entertainment', isActive: true, sortOrder: 1 },
        { id: 2, name: 'music', displayName: 'Music', isActive: true, sortOrder: 2 },
      ]),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ ...data, id: Math.random() })),
    };
    videoCategoryRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ ...data, id: Math.random() })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(10),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getRepositoryToken(Category), useValue: categoryRepo },
        { provide: getRepositoryToken(VideoCategory), useValue: videoCategoryRepo },
      ],
    }).compile();
    service = module.get<CategoriesService>(CategoriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should seed categories when none exist', async () => {
      categoryRepo.find.mockResolvedValueOnce([]); // seedDefaultCategories check
      await service.onModuleInit();
      expect(categoryRepo.create).toHaveBeenCalled();
      expect(categoryRepo.save).toHaveBeenCalled();
    });

    it('should skip seeding when categories already exist', async () => {
      categoryRepo.find.mockResolvedValueOnce([{ id: 1 }]); // already seeded
      await service.onModuleInit();
      // save should not have been called for seeding
      expect(categoryRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getAllCategories', () => {
    it('should return active categories', async () => {
      const result = await service.getAllCategories();
      expect(result).toHaveLength(2);
      expect(categoryRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { sortOrder: 'ASC' },
      });
    });
  });

  describe('getCategoryById', () => {
    it('should return a category by ID', async () => {
      categoryRepo.findOne.mockResolvedValue({ id: 1, name: 'entertainment' });
      const result = await service.getCategoryById(1);
      expect(result?.id).toBe(1);
    });

    it('should return null if not found', async () => {
      categoryRepo.findOne.mockResolvedValue(null);
      expect(await service.getCategoryById(999)).toBeNull();
    });
  });

  describe('getCategoriesByIds', () => {
    it('should return categories by IDs', async () => {
      const result = await service.getCategoriesByIds([1, 2]);
      expect(result).toHaveLength(2);
    });
  });

  describe('assignCategoriesToVideo', () => {
    it('should remove existing and assign new categories', async () => {
      const result = await service.assignCategoriesToVideo('v1', [1, 2, 3]);
      expect(videoCategoryRepo.delete).toHaveBeenCalledWith({ videoId: 'v1' });
      expect(videoCategoryRepo.save).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
    });
  });

  describe('getVideoCategories', () => {
    it('should return active categories for a video', async () => {
      videoCategoryRepo.find.mockResolvedValue([
        { videoId: 'v1', category: { id: 1, displayName: 'Music', isActive: true } },
        { videoId: 'v1', category: { id: 2, displayName: 'Dance', isActive: false } },
        { videoId: 'v1', category: null },
      ]);
      const result = await service.getVideoCategories('v1');
      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe('Music');
    });
  });

  describe('getVideoCategoriesWithAiInfo', () => {
    it('should return categories with AI info', async () => {
      videoCategoryRepo.find.mockResolvedValue([
        { videoId: 'v1', isAiSuggested: true, category: { id: 1, displayName: 'Music', isActive: true } },
        { videoId: 'v1', isAiSuggested: undefined, category: { id: 2, displayName: 'Dance', isActive: true } },
      ]);
      const result = await service.getVideoCategoriesWithAiInfo('v1');
      expect(result).toHaveLength(2);
      expect(result[0].isAiSuggested).toBe(true);
      expect(result[1].isAiSuggested).toBe(false);
    });
  });

  describe('addAiCategoriesToVideo', () => {
    it('should add only new AI categories', async () => {
      videoCategoryRepo.find.mockResolvedValue([
        { videoId: 'v1', categoryId: 1 },
      ]);
      const result = await service.addAiCategoriesToVideo('v1', [1, 2, 3]);
      expect(videoCategoryRepo.save).toHaveBeenCalledTimes(2); // only 2 and 3
      expect(result).toHaveLength(2);
    });

    it('should return empty if all categories already exist', async () => {
      videoCategoryRepo.find.mockResolvedValue([
        { videoId: 'v1', categoryId: 1 },
        { videoId: 'v1', categoryId: 2 },
      ]);
      const result = await service.addAiCategoriesToVideo('v1', [1, 2]);
      expect(result).toHaveLength(0);
    });
  });

  describe('getVideoIdsByCategory', () => {
    it('should return video IDs for a category', async () => {
      videoCategoryRepo.find.mockResolvedValue([
        { videoId: 'v1', categoryId: 1 },
        { videoId: 'v2', categoryId: 1 },
      ]);
      const result = await service.getVideoIdsByCategory(1);
      expect(result).toEqual(['v1', 'v2']);
    });
  });

  describe('getVideoIdsByCategories', () => {
    it('should return unique video IDs for categories', async () => {
      videoCategoryRepo.find.mockResolvedValue([
        { videoId: 'v1', categoryId: 1 },
        { videoId: 'v1', categoryId: 2 },
        { videoId: 'v2', categoryId: 1 },
      ]);
      const result = await service.getVideoIdsByCategories([1, 2]);
      expect(result).toEqual(['v1', 'v2']);
    });

    it('should return empty for empty input', async () => {
      const result = await service.getVideoIdsByCategories([]);
      expect(result).toEqual([]);
    });
  });

  describe('getCategoryStats', () => {
    it('should return video counts per category', async () => {
      const result = await service.getCategoryStats();
      expect(result).toHaveLength(2);
      expect(result[0].videoCount).toBe(10);
    });
  });

  describe('getVideoCategoriesBulk', () => {
    it('should return categories map for videos', async () => {
      videoCategoryRepo.find.mockResolvedValue([
        { videoId: 'v1', categoryId: 1, isAiSuggested: false, category: { id: 1, displayName: 'Music', isActive: true } },
        { videoId: 'v1', categoryId: 2, isAiSuggested: true, category: { id: 2, displayName: 'Dance', isActive: true } },
        { videoId: 'v2', categoryId: 1, isAiSuggested: undefined, category: { id: 1, displayName: 'Music', isActive: true } },
        { videoId: 'v3', categoryId: 3, category: null },
      ]);
      const result = await service.getVideoCategoriesBulk(['v1', 'v2', 'v3']);
      expect(result.get('v1')).toHaveLength(2);
      expect(result.get('v2')).toHaveLength(1);
      expect(result.has('v3')).toBe(false); // null category filtered out
    });

    it('should return empty map for empty input', async () => {
      const result = await service.getVideoCategoriesBulk([]);
      expect(result.size).toBe(0);
    });
  });
});

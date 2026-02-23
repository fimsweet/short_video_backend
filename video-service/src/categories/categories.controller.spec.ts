import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

describe('CategoriesController', () => {
  let controller: CategoriesController;
  let service: any;

  beforeEach(async () => {
    service = {
      getAllCategories: jest.fn().mockResolvedValue([{ id: 1, name: 'Gaming' }]),
      getCategoryById: jest.fn().mockResolvedValue({ id: 1, name: 'Gaming' }),
      getVideoCategories: jest.fn().mockResolvedValue([]),
      assignCategoriesToVideo: jest.fn().mockResolvedValue([]),
      addAiCategoriesToVideo: jest.fn().mockResolvedValue([]),
      getVideoCategoriesWithAiInfo: jest.fn().mockResolvedValue([]),
      getCategoryStats: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [{ provide: CategoriesService, useValue: service }],
    }).compile();

    controller = module.get<CategoriesController>(CategoriesController);
  });

  it('should get all categories', async () => {
    const result = await controller.getAllCategories();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('should get category by id', async () => {
    const result = await controller.getCategoryById('1');
    expect(result.success).toBe(true);
  });

  it('should return not found for missing category', async () => {
    service.getCategoryById.mockResolvedValue(null);
    const result = await controller.getCategoryById('999');
    expect(result.success).toBe(false);
  });

  it('should get video categories', async () => {
    const result = await controller.getVideoCategories('v1');
    expect(result.success).toBe(true);
  });

  it('should assign categories', async () => {
    const result = await controller.assignCategoriesToVideo('v1', { categoryIds: [1, 2] });
    expect(result.success).toBe(true);
  });

  it('should add AI categories', async () => {
    const result = await controller.addAiCategoriesToVideo('v1', { categoryIds: [1] });
    expect(result.success).toBe(true);
  });

  it('should get categories with AI info', async () => {
    const result = await controller.getVideoCategoriesWithAiInfo('v1');
    expect(result.success).toBe(true);
  });

  it('should get stats', async () => {
    const result = await controller.getCategoryStats();
    expect(result.success).toBe(true);
  });
});

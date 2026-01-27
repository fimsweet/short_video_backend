import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Category } from '../entities/category.entity';
import { VideoCategory } from '../entities/video-category.entity';

// Default categories for the app
const DEFAULT_CATEGORIES = [
  { name: 'entertainment', displayName: 'Entertainment', displayNameVi: 'Giải trí', icon: '🎬', sortOrder: 1 },
  { name: 'music', displayName: 'Music', displayNameVi: 'Âm nhạc', icon: '🎵', sortOrder: 2 },
  { name: 'dance', displayName: 'Dance', displayNameVi: 'Nhảy', icon: '💃', sortOrder: 3 },
  { name: 'comedy', displayName: 'Comedy', displayNameVi: 'Hài hước', icon: '😂', sortOrder: 4 },
  { name: 'food', displayName: 'Food & Cooking', displayNameVi: 'Ẩm thực', icon: '🍳', sortOrder: 5 },
  { name: 'travel', displayName: 'Travel', displayNameVi: 'Du lịch', icon: '✈️', sortOrder: 6 },
  { name: 'sports', displayName: 'Sports', displayNameVi: 'Thể thao', icon: '⚽', sortOrder: 7 },
  { name: 'education', displayName: 'Education', displayNameVi: 'Giáo dục', icon: '📚', sortOrder: 8 },
  { name: 'gaming', displayName: 'Gaming', displayNameVi: 'Trò chơi', icon: '🎮', sortOrder: 9 },
  { name: 'beauty', displayName: 'Beauty', displayNameVi: 'Làm đẹp', icon: '💄', sortOrder: 10 },
  { name: 'fashion', displayName: 'Fashion', displayNameVi: 'Thời trang', icon: '👗', sortOrder: 11 },
  { name: 'technology', displayName: 'Technology', displayNameVi: 'Công nghệ', icon: '💻', sortOrder: 12 },
  { name: 'pets', displayName: 'Pets & Animals', displayNameVi: 'Thú cưng', icon: '🐕', sortOrder: 13 },
  { name: 'lifestyle', displayName: 'Lifestyle', displayNameVi: 'Phong cách sống', icon: '🌟', sortOrder: 14 },
  { name: 'news', displayName: 'News', displayNameVi: 'Tin tức', icon: '📰', sortOrder: 15 },
];

@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(
    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,
    @InjectRepository(VideoCategory)
    private videoCategoryRepository: Repository<VideoCategory>,
  ) {}

  // Seed default categories on module initialization
  async onModuleInit() {
    await this.seedDefaultCategories();
  }

  private async seedDefaultCategories(): Promise<void> {
    const existingCategories = await this.categoryRepository.find();
    
    if (existingCategories.length === 0) {
      console.log('🏷️ Seeding default categories...');
      
      for (const categoryData of DEFAULT_CATEGORIES) {
        const category = this.categoryRepository.create(categoryData);
        await this.categoryRepository.save(category);
      }
      
      console.log(`✅ Created ${DEFAULT_CATEGORIES.length} default categories`);
    }
  }

  // Get all active categories
  async getAllCategories(): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  // Get category by ID
  async getCategoryById(id: number): Promise<Category | null> {
    return this.categoryRepository.findOne({ where: { id } });
  }

  // Get categories by IDs
  async getCategoriesByIds(ids: number[]): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { id: In(ids), isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  // Assign categories to a video
  async assignCategoriesToVideo(videoId: string, categoryIds: number[]): Promise<VideoCategory[]> {
    // Remove existing categories for this video
    await this.videoCategoryRepository.delete({ videoId });

    // Create new video-category relationships
    const videoCategories: VideoCategory[] = [];
    for (const categoryId of categoryIds) {
      const videoCategory = this.videoCategoryRepository.create({
        videoId,
        categoryId,
      });
      const saved = await this.videoCategoryRepository.save(videoCategory);
      videoCategories.push(saved);
    }

    console.log(`🏷️ Assigned ${categoryIds.length} categories to video ${videoId}`);
    return videoCategories;
  }

  // Get categories for a video
  async getVideoCategories(videoId: string): Promise<Category[]> {
    const videoCategories = await this.videoCategoryRepository.find({
      where: { videoId },
      relations: ['category'],
    });
    
    return videoCategories
      .map(vc => vc.category)
      .filter(c => c && c.isActive);
  }

  // Get video IDs by category
  async getVideoIdsByCategory(categoryId: number, limit: number = 100): Promise<string[]> {
    const videoCategories = await this.videoCategoryRepository.find({
      where: { categoryId },
      take: limit,
      order: { createdAt: 'DESC' },
    });
    
    return videoCategories.map(vc => vc.videoId);
  }

  // Get video IDs by multiple categories
  async getVideoIdsByCategories(categoryIds: number[], limit: number = 100): Promise<string[]> {
    if (categoryIds.length === 0) return [];

    const videoCategories = await this.videoCategoryRepository.find({
      where: { categoryId: In(categoryIds) },
      take: limit,
      order: { createdAt: 'DESC' },
    });
    
    // Return unique video IDs
    return [...new Set(videoCategories.map(vc => vc.videoId))];
  }

  // Get category statistics (video count per category)
  async getCategoryStats(): Promise<{ categoryId: number; name: string; videoCount: number }[]> {
    const categories = await this.getAllCategories();
    const stats: { categoryId: number; name: string; videoCount: number }[] = [];

    for (const category of categories) {
      const count = await this.videoCategoryRepository.count({
        where: { categoryId: category.id },
      });
      stats.push({
        categoryId: category.id,
        name: category.displayName,
        videoCount: count,
      });
    }

    return stats;
  }

  // Get categories for multiple videos (bulk query for performance)
  async getVideoCategoriesBulk(videoIds: string[]): Promise<Map<string, { categoryId: number; categoryName: string }[]>> {
    if (videoIds.length === 0) {
      return new Map();
    }

    const videoCategories = await this.videoCategoryRepository.find({
      where: { videoId: In(videoIds) },
      relations: ['category'],
    });

    const result = new Map<string, { categoryId: number; categoryName: string }[]>();
    
    for (const vc of videoCategories) {
      if (!vc.category || !vc.category.isActive) continue;
      
      const categories = result.get(vc.videoId) || [];
      categories.push({
        categoryId: vc.categoryId,
        categoryName: vc.category.displayName,
      });
      result.set(vc.videoId, categories);
    }

    return result;
  }
}

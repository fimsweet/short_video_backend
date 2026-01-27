import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  // GET /categories - Get all active categories
  @Get()
  async getAllCategories() {
    const categories = await this.categoriesService.getAllCategories();
    return {
      success: true,
      data: categories,
    };
  }

  // GET /categories/:id - Get category by ID
  @Get(':id')
  async getCategoryById(@Param('id') id: string) {
    const category = await this.categoriesService.getCategoryById(parseInt(id));
    if (!category) {
      return {
        success: false,
        message: 'Category not found',
      };
    }
    return {
      success: true,
      data: category,
    };
  }

  // GET /categories/video/:videoId - Get categories for a video
  @Get('video/:videoId')
  async getVideoCategories(@Param('videoId') videoId: string) {
    const categories = await this.categoriesService.getVideoCategories(videoId);
    return {
      success: true,
      data: categories,
    };
  }

  // POST /categories/video/:videoId/assign - Assign categories to a video
  @Post('video/:videoId/assign')
  async assignCategoriesToVideo(
    @Param('videoId') videoId: string,
    @Body() body: { categoryIds: number[] },
  ) {
    const videoCategories = await this.categoriesService.assignCategoriesToVideo(
      videoId,
      body.categoryIds,
    );
    return {
      success: true,
      data: videoCategories,
      message: `Assigned ${body.categoryIds.length} categories to video`,
    };
  }

  // GET /categories/stats - Get category statistics
  @Get('stats/all')
  async getCategoryStats() {
    const stats = await this.categoriesService.getCategoryStats();
    return {
      success: true,
      data: stats,
    };
  }
}

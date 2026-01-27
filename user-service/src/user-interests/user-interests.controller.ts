import { Controller, Get, Post, Delete, Param, Body, ParseIntPipe } from '@nestjs/common';
import { UserInterestsService } from './user-interests.service';

@Controller('users')
export class UserInterestsController {
  constructor(private readonly userInterestsService: UserInterestsService) {}

  /**
   * GET /users/categories
   * Get all available categories for interest selection
   */
  @Get('categories')
  async getAvailableCategories() {
    const categories = await this.userInterestsService.getAvailableCategories();
    return {
      success: true,
      data: categories,
    };
  }

  /**
   * GET /users/:userId/interests
   * Get user's interests
   */
  @Get(':userId/interests')
  async getUserInterests(@Param('userId', ParseIntPipe) userId: number) {
    const interests = await this.userInterestsService.getUserInterests(userId);
    return {
      success: true,
      data: interests,
    };
  }

  /**
   * GET /users/:userId/interests/check
   * Check if user has selected interests
   */
  @Get(':userId/interests/check')
  async hasSelectedInterests(@Param('userId', ParseIntPipe) userId: number) {
    const hasInterests = await this.userInterestsService.hasSelectedInterests(userId);
    return {
      success: true,
      hasInterests,
    };
  }

  /**
   * POST /users/:userId/interests
   * Set user's interests (replaces existing)
   */
  @Post(':userId/interests')
  async setUserInterests(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: { categoryIds: number[] },
  ) {
    if (!body.categoryIds || body.categoryIds.length < 3) {
      return {
        success: false,
        message: 'Please select at least 3 categories',
      };
    }

    try {
      const interests = await this.userInterestsService.setUserInterests(
        userId,
        body.categoryIds,
      );
      return {
        success: true,
        data: interests,
        message: `Successfully set ${interests.length} interests`,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * POST /users/:userId/interests/add
   * Add interests to user
   */
  @Post(':userId/interests/add')
  async addUserInterests(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: { categoryIds: number[] },
  ) {
    const interests = await this.userInterestsService.addUserInterests(
      userId,
      body.categoryIds,
    );
    return {
      success: true,
      data: interests,
      message: `Added ${interests.length} new interests`,
    };
  }

  /**
   * DELETE /users/:userId/interests/:categoryId
   * Remove an interest
   */
  @Delete(':userId/interests/:categoryId')
  async removeUserInterest(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('categoryId', ParseIntPipe) categoryId: number,
  ) {
    const removed = await this.userInterestsService.removeUserInterest(userId, categoryId);
    return {
      success: removed,
      message: removed ? 'Interest removed' : 'Interest not found',
    };
  }

  /**
   * GET /users/:userId/interests/stats
   * Get interest statistics
   */
  @Get(':userId/interests/stats')
  async getInterestStats(@Param('userId', ParseIntPipe) userId: number) {
    const stats = await this.userInterestsService.getInterestStats(userId);
    return {
      success: true,
      data: stats,
    };
  }
}

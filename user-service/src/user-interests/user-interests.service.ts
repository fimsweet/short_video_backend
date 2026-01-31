import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { UserInterest } from '../entities/user-interest.entity';
import { User } from '../entities/user.entity';

export interface Category {
  id: number;
  name: string;
  displayName: string;
  displayNameVi: string;
  icon: string;
}

@Injectable()
export class UserInterestsService {
  constructor(
    @InjectRepository(UserInterest)
    private userInterestRepository: Repository<UserInterest>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
    private httpService: HttpService,
  ) {}

  /**
   * Get available categories from video-service
   */
  async getAvailableCategories(): Promise<Category[]> {
    try {
      const videoServiceUrl = this.configService.get<string>('VIDEO_SERVICE_URL') || 'http://localhost:3002';
      const response = await firstValueFrom(
        this.httpService.get(`${videoServiceUrl}/categories`)
      );
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching categories:', error.message);
      return [];
    }
  }

  /**
   * Get user's interests
   */
  async getUserInterests(userId: number): Promise<UserInterest[]> {
    return this.userInterestRepository.find({
      where: { userId },
      order: { weight: 'DESC' },
    });
  }

  /**
   * Check if user has selected interests
   */
  async hasSelectedInterests(userId: number): Promise<boolean> {
    const count = await this.userInterestRepository.count({
      where: { userId },
    });
    return count > 0;
  }

  /**
   * Set user's interests (replace all existing)
   */
  async setUserInterests(userId: number, categoryIds: number[]): Promise<UserInterest[]> {
    // Validate user exists
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // Get category details from video-service
    const categories = await this.getAvailableCategories();
    const categoryMap = new Map(categories.map(c => [c.id, c]));

    // Delete existing interests
    await this.userInterestRepository.delete({ userId });

    // Create new interests
    const interests: UserInterest[] = [];
    for (const categoryId of categoryIds) {
      const category = categoryMap.get(categoryId);
      if (category) {
        const interest = this.userInterestRepository.create({
          userId,
          categoryId,
          categoryName: category.displayName,
          weight: 1.0,
        });
        const saved = await this.userInterestRepository.save(interest);
        interests.push(saved);
      }
    }

    console.log(`Set ${interests.length} interests for user ${userId}`);
    return interests;
  }

  /**
   * Add interests to user (without removing existing)
   */
  async addUserInterests(userId: number, categoryIds: number[]): Promise<UserInterest[]> {
    const categories = await this.getAvailableCategories();
    const categoryMap = new Map(categories.map(c => [c.id, c]));

    const existingInterests = await this.userInterestRepository.find({
      where: { userId },
    });
    const existingCategoryIds = new Set(existingInterests.map(i => i.categoryId));

    const newInterests: UserInterest[] = [];
    for (const categoryId of categoryIds) {
      if (!existingCategoryIds.has(categoryId)) {
        const category = categoryMap.get(categoryId);
        if (category) {
          const interest = this.userInterestRepository.create({
            userId,
            categoryId,
            categoryName: category.displayName,
            weight: 1.0,
          });
          const saved = await this.userInterestRepository.save(interest);
          newInterests.push(saved);
        }
      }
    }

    return newInterests;
  }

  /**
   * Remove an interest from user
   */
  async removeUserInterest(userId: number, categoryId: number): Promise<boolean> {
    const result = await this.userInterestRepository.delete({
      userId,
      categoryId,
    });
    return (result.affected || 0) > 0;
  }

  /**
   * Update interest weight (for learning from user behavior)
   */
  async updateInterestWeight(userId: number, categoryId: number, delta: number): Promise<void> {
    const interest = await this.userInterestRepository.findOne({
      where: { userId, categoryId },
    });

    if (interest) {
      interest.weight = Math.max(0.1, Math.min(2.0, interest.weight + delta));
      await this.userInterestRepository.save(interest);
    }
  }

  /**
   * Boost interest weight when user engages with a category
   * Call this when user likes/saves/comments on a video
   */
  async boostInterestFromEngagement(userId: number, categoryIds: number[]): Promise<void> {
    for (const categoryId of categoryIds) {
      const existing = await this.userInterestRepository.findOne({
        where: { userId, categoryId },
      });

      if (existing) {
        // Boost existing interest
        await this.updateInterestWeight(userId, categoryId, 0.1);
      } else {
        // Create new implicit interest with lower weight
        const categories = await this.getAvailableCategories();
        const category = categories.find(c => c.id === categoryId);
        if (category) {
          const interest = this.userInterestRepository.create({
            userId,
            categoryId,
            categoryName: category.displayName,
            weight: 0.5, // Lower weight for implicit interests
          });
          await this.userInterestRepository.save(interest);
        }
      }
    }
  }

  /**
   * Get interest statistics for a user
   */
  async getInterestStats(userId: number): Promise<{ total: number; categories: string[] }> {
    const interests = await this.getUserInterests(userId);
    return {
      total: interests.length,
      categories: interests.map(i => i.categoryName),
    };
  }
}

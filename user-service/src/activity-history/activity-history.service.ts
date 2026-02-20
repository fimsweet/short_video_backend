import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityHistory } from '../entities/activity-history.entity';

export interface LogActivityDto {
    userId: number;
    actionType: string;
    targetId?: string;
    targetType?: string;
    metadata?: Record<string, any>;
}

@Injectable()
export class ActivityHistoryService {
    constructor(
        @InjectRepository(ActivityHistory)
        private activityRepository: Repository<ActivityHistory>,
    ) { }

    async logActivity(dto: LogActivityDto): Promise<ActivityHistory> {
        const activity = this.activityRepository.create({
            userId: dto.userId,
            actionType: dto.actionType,
            targetId: dto.targetId,
            targetType: dto.targetType,
            metadata: dto.metadata,
        });
        return this.activityRepository.save(activity);
    }

    async getActivityHistory(
        userId: number,
        page: number = 1,
        limit: number = 20,
        filter?: string,
    ): Promise<{ activities: ActivityHistory[]; total: number; hasMore: boolean }> {
        const queryBuilder = this.activityRepository
            .createQueryBuilder('activity')
            .where('activity.userId = :userId', { userId })
            .orderBy('activity.createdAt', 'DESC');

        if (filter && filter !== 'all') {
            switch (filter) {
                case 'videos':
                    queryBuilder.andWhere('activity.actionType IN (:...types)', {
                        types: ['video_posted', 'video_deleted', 'video_hidden'],
                    });
                    break;
                case 'social':
                    queryBuilder.andWhere('activity.actionType IN (:...types)', {
                        types: ['follow', 'unfollow', 'like', 'unlike'],
                    });
                    break;
                case 'comments':
                    queryBuilder.andWhere('activity.actionType IN (:...types)', {
                        types: ['comment', 'comment_deleted'],
                    });
                    break;
            }
        }

        const total = await queryBuilder.getCount();
        const activities = await queryBuilder
            .skip((page - 1) * limit)
            .take(limit)
            .getMany();

        return {
            activities,
            total,
            hasMore: page * limit < total,
        };
    }

    async deleteOldActivities(userId: number, olderThanDays: number = 90): Promise<number> {
        const result = await this.activityRepository
            .createQueryBuilder()
            .delete()
            .where('userId = :userId', { userId })
            .andWhere('createdAt < NOW() - INTERVAL :days DAY', { days: olderThanDays })
            .execute();
        return result.affected || 0;
    }

    // Delete a single activity
    async deleteActivity(userId: number, activityId: number): Promise<{ success: boolean; message: string }> {
        const activity = await this.activityRepository.findOne({
            where: { id: activityId, userId },
        });

        if (!activity) {
            return { success: false, message: 'Activity not found or unauthorized' };
        }

        await this.activityRepository.remove(activity);
        return { success: true, message: 'Activity deleted successfully' };
    }

    // Delete all activities for a user
    async deleteAllActivities(userId: number): Promise<{ success: boolean; deletedCount: number }> {
        const result = await this.activityRepository
            .createQueryBuilder()
            .delete()
            .where('userId = :userId', { userId })
            .execute();

        return {
            success: true,
            deletedCount: result.affected || 0,
        };
    }

    // Delete activities by action type
    async deleteActivitiesByType(
        userId: number,
        actionType: string,
    ): Promise<{ success: boolean; deletedCount: number }> {
        // Map filter category to action types
        let types: string[] = [];
        switch (actionType) {
            case 'videos':
                types = ['video_posted', 'video_deleted', 'video_hidden', 'privacy_updated'];
                break;
            case 'social':
                types = ['follow', 'unfollow', 'like', 'unlike'];
                break;
            case 'comments':
                types = ['comment', 'comment_deleted'];
                break;
            case 'likes':
                types = ['like', 'unlike'];
                break;
            case 'follows':
                types = ['follow', 'unfollow'];
                break;
            default:
                types = [actionType];
        }

        const result = await this.activityRepository
            .createQueryBuilder()
            .delete()
            .where('userId = :userId', { userId })
            .andWhere('actionType IN (:...types)', { types })
            .execute();

        return {
            success: true,
            deletedCount: result.affected || 0,
        };
    }

    // Delete activities by time range
    async deleteActivitiesByTimeRange(
        userId: number,
        timeRange: 'today' | 'week' | 'month' | 'all',
        filter?: string,
    ): Promise<{ success: boolean; deletedCount: number }> {
        const queryBuilder = this.activityRepository
            .createQueryBuilder()
            .delete()
            .where('userId = :userId', { userId });

        // Apply time range filter
        const now = new Date();
        switch (timeRange) {
            case 'today':
                const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                queryBuilder.andWhere('createdAt >= :startOfDay', { startOfDay });
                break;
            case 'week':
                const startOfWeek = new Date(now);
                startOfWeek.setDate(now.getDate() - 7);
                queryBuilder.andWhere('createdAt >= :startOfWeek', { startOfWeek });
                break;
            case 'month':
                const startOfMonth = new Date(now);
                startOfMonth.setMonth(now.getMonth() - 1);
                queryBuilder.andWhere('createdAt >= :startOfMonth', { startOfMonth });
                break;
            case 'all':
                // No time filter
                break;
        }

        // Apply activity type filter if provided
        if (filter && filter !== 'all') {
            let types: string[] = [];
            switch (filter) {
                case 'videos':
                    types = ['video_posted', 'video_deleted', 'video_hidden'];
                    break;
                case 'social':
                    types = ['follow', 'unfollow', 'like', 'unlike'];
                    break;
                case 'comments':
                    types = ['comment', 'comment_deleted'];
                    break;
                case 'likes':
                    types = ['like', 'unlike'];
                    break;
                case 'follows':
                    types = ['follow', 'unfollow'];
                    break;
                default:
                    types = [filter];
            }
            queryBuilder.andWhere('actionType IN (:...types)', { types });
        }

        const result = await queryBuilder.execute();

        return {
            success: true,
            deletedCount: result.affected || 0,
        };
    }

    // Get activity count by time range and filter
    async getActivityCount(
        userId: number,
        timeRange: 'today' | 'week' | 'month' | 'all',
        filter?: string,
    ): Promise<{ count: number }> {
        const queryBuilder = this.activityRepository
            .createQueryBuilder('activity')
            .where('activity.userId = :userId', { userId });

        // Apply time range filter
        const now = new Date();
        switch (timeRange) {
            case 'today':
                const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                queryBuilder.andWhere('activity.createdAt >= :startOfDay', { startOfDay });
                break;
            case 'week':
                const startOfWeek = new Date(now);
                startOfWeek.setDate(now.getDate() - 7);
                queryBuilder.andWhere('activity.createdAt >= :startOfWeek', { startOfWeek });
                break;
            case 'month':
                const startOfMonth = new Date(now);
                startOfMonth.setMonth(now.getMonth() - 1);
                queryBuilder.andWhere('activity.createdAt >= :startOfMonth', { startOfMonth });
                break;
            case 'all':
                // No time filter
                break;
        }

        // Apply activity type filter if provided
        if (filter && filter !== 'all') {
            let types: string[] = [];
            switch (filter) {
                case 'videos':
                    types = ['video_posted', 'video_deleted', 'video_hidden'];
                    break;
                case 'social':
                    types = ['follow', 'unfollow', 'like', 'unlike'];
                    break;
                case 'comments':
                    types = ['comment', 'comment_deleted'];
                    break;
                case 'likes':
                    types = ['like', 'unlike'];
                    break;
                case 'follows':
                    types = ['follow', 'unfollow'];
                    break;
                default:
                    types = [filter];
            }
            queryBuilder.andWhere('activity.actionType IN (:...types)', { types });
        }

        const count = await queryBuilder.getCount();
        return { count };
    }
}

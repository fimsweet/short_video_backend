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
}

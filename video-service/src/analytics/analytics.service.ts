import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Video } from '../entities/video.entity';
import { Like } from '../entities/like.entity';
import { Comment } from '../entities/comment.entity';
import { Share } from '../entities/share.entity';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AnalyticsService {
    private readonly userServiceUrl: string;

    constructor(
        @InjectRepository(Video)
        private videoRepository: Repository<Video>,
        @InjectRepository(Like)
        private likeRepository: Repository<Like>,
        @InjectRepository(Comment)
        private commentRepository: Repository<Comment>,
        @InjectRepository(Share)
        private shareRepository: Repository<Share>,
        private httpService: HttpService,
        private configService: ConfigService,
    ) {
        this.userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
    }

    async getUserAnalytics(userId: string): Promise<any> {
        // Get all videos from this user
        const videos = await this.videoRepository.find({
            where: { userId: userId },
        });

        const videoIds = videos.map(v => v.id);

        // Calculate total stats
        let totalViews = 0;
        let totalLikes = 0;
        let totalComments = 0;
        let totalShares = 0;

        for (const video of videos) {
            totalViews += video.viewCount || 0;
        }

        // Count likes for all user's videos
        if (videoIds.length > 0) {
            totalLikes = await this.likeRepository
                .createQueryBuilder('like')
                .where('like.videoId IN (:...videoIds)', { videoIds })
                .getCount();

            totalComments = await this.commentRepository
                .createQueryBuilder('comment')
                .where('comment.videoId IN (:...videoIds)', { videoIds })
                .getCount();

            totalShares = await this.shareRepository
                .createQueryBuilder('share')
                .where('share.videoId IN (:...videoIds)', { videoIds })
                .getCount();
        }

        // Get follower count from user-service
        let followersCount = 0;
        let followingCount = 0;
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.userServiceUrl}/users/${userId}`)
            );
            followersCount = response.data?.followersCount || 0;
            followingCount = response.data?.followingCount || 0;
        } catch (error) {
            console.error('Error fetching user stats:', error);
        }

        // Get video stats (likes per video)
        const videoLikeCounts: Map<string, number> = new Map();
        if (videoIds.length > 0) {
            const likeCounts = await this.likeRepository
                .createQueryBuilder('like')
                .select('like.videoId', 'videoId')
                .addSelect('COUNT(*)', 'count')
                .where('like.videoId IN (:...videoIds)', { videoIds })
                .groupBy('like.videoId')
                .getRawMany();
            likeCounts.forEach(lc => videoLikeCounts.set(lc.videoId, parseInt(lc.count)));
        }

        // Get all videos with full stats for sorting
        const allVideos = videos.map(v => {
            return {
                id: v.id,
                title: v.title || 'Untitled',
                thumbnailUrl: v.thumbnailUrl || null,
                views: v.viewCount || 0,
                likes: videoLikeCounts.get(v.id) || 0,
                createdAt: v.createdAt,
            };
        });

        // Top videos by views (top 5)
        const topVideos = [...allVideos]
            .sort((a, b) => b.views - a.views)
            .slice(0, 5);

        // Get recent video performance (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentVideos = videos.filter(v => new Date(v.createdAt) >= sevenDaysAgo);
        const recentViews = recentVideos.reduce((sum, v) => sum + (v.viewCount || 0), 0);

        // Calculate engagement rate
        const engagementRate = totalViews > 0
            ? ((totalLikes + totalComments + totalShares) / totalViews * 100).toFixed(2)
            : '0.00';

        // Generate daily stats for charts (last 7 days)
        const dailyStats: { date: string; views: number; likes: number; comments: number }[] = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);

            // Count videos created on this day and their views
            const dayVideos = videos.filter(v => {
                const createdAt = new Date(v.createdAt);
                return createdAt >= date && createdAt < nextDate;
            });
            const dayViews = dayVideos.reduce((sum, v) => sum + (v.viewCount || 0), 0);

            // Count likes on this day
            let dayLikes = 0;
            let dayComments = 0;
            if (videoIds.length > 0) {
                dayLikes = await this.likeRepository
                    .createQueryBuilder('like')
                    .where('like.videoId IN (:...videoIds)', { videoIds })
                    .andWhere('like.createdAt >= :start AND like.createdAt < :end', { start: date, end: nextDate })
                    .getCount();

                dayComments = await this.commentRepository
                    .createQueryBuilder('comment')
                    .where('comment.videoId IN (:...videoIds)', { videoIds })
                    .andWhere('comment.createdAt >= :start AND comment.createdAt < :end', { start: date, end: nextDate })
                    .getCount();
            }

            dailyStats.push({
                date: date.toISOString().split('T')[0],
                views: dayViews,
                likes: dayLikes,
                comments: dayComments,
            });
        }

        // Distribution data for pie chart
        const distribution = {
            likes: totalLikes,
            comments: totalComments,
            shares: totalShares,
            saves: 0, // Can be added if save tracking exists
        };

        return {
            success: true,
            analytics: {
                overview: {
                    totalVideos: videos.length,
                    totalViews,
                    totalLikes,
                    totalComments,
                    totalShares,
                    followersCount,
                    followingCount,
                    engagementRate: parseFloat(engagementRate),
                },
                recent: {
                    videosLast7Days: recentVideos.length,
                    viewsLast7Days: recentViews,
                },
                dailyStats,
                distribution,
                topVideos,
                allVideos, // Return all videos for sorting/filtering on client
            },
        };
    }
}

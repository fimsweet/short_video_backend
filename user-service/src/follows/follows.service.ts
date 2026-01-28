import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Follow } from '../entities/follow.entity';
import { ActivityHistoryService } from '../activity-history/activity-history.service';

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(Follow)
    private followRepository: Repository<Follow>,
    private configService: ConfigService,
    private httpService: HttpService,
    private activityHistoryService: ActivityHistoryService,
  ) { }

  async toggleFollow(followerId: number, followingId: number): Promise<{ following: boolean }> {
    if (followerId === followingId) {
      throw new Error('Cannot follow yourself');
    }

    const existingFollow = await this.followRepository.findOne({
      where: { followerId, followingId },
    });

    if (existingFollow) {
      await this.followRepository.remove(existingFollow);

      // Log unfollow activity
      try {
        await this.activityHistoryService.logActivity({
          userId: followerId,
          actionType: 'unfollow',
          targetId: followingId.toString(),
          targetType: 'user',
        });
      } catch (e) {
        console.error('Error logging unfollow activity:', e);
      }

      return { following: false };
    } else {
      const newFollow = this.followRepository.create({ followerId, followingId });
      await this.followRepository.save(newFollow);

      // Log follow activity
      try {
        await this.activityHistoryService.logActivity({
          userId: followerId,
          actionType: 'follow',
          targetId: followingId.toString(),
          targetType: 'user',
        });
      } catch (e) {
        console.error('Error logging follow activity:', e);
      }

      // Send notification to video-service
      try {
        const videoServiceUrl = this.configService.get<string>('VIDEO_SERVICE_URL') || 'http://localhost:3001';
        await firstValueFrom(
          this.httpService.post(`${videoServiceUrl}/notifications/create`, {
            recipientId: followingId.toString(),
            senderId: followerId.toString(),
            type: 'follow',
          })
        );
      } catch (e) {
        console.error('Error sending follow notification:', e);
      }

      return { following: true };
    }
  }

  async isFollowing(followerId: number, followingId: number): Promise<boolean> {
    const follow = await this.followRepository.findOne({
      where: { followerId, followingId },
    });
    return !!follow;
  }

  async isMutualFollow(userId1: number, userId2: number): Promise<boolean> {
    const [follow1, follow2] = await Promise.all([
      this.followRepository.findOne({ where: { followerId: userId1, followingId: userId2 } }),
      this.followRepository.findOne({ where: { followerId: userId2, followingId: userId1 } }),
    ]);
    return !!follow1 && !!follow2;
  }

  async getFollowerCount(userId: number): Promise<number> {
    return this.followRepository.count({ where: { followingId: userId } });
  }

  async getFollowingCount(userId: number): Promise<number> {
    return this.followRepository.count({ where: { followerId: userId } });
  }

  async getFollowers(userId: number): Promise<number[]> {
    const follows = await this.followRepository.find({
      where: { followingId: userId },
      select: ['followerId'],
    });
    return follows.map(f => f.followerId);
  }

  async getFollowersWithMutualStatus(userId: number): Promise<{ userId: number; isMutual: boolean }[]> {
    const followers = await this.followRepository.find({
      where: { followingId: userId },
      select: ['followerId'],
    });

    const result = await Promise.all(
      followers.map(async (f) => {
        const isMutual = await this.isFollowing(userId, f.followerId);
        return { userId: f.followerId, isMutual };
      })
    );

    return result;
  }

  async getFollowing(userId: number): Promise<number[]> {
    const follows = await this.followRepository.find({
      where: { followerId: userId },
      select: ['followingId'],
    });
    return follows.map(f => f.followingId);
  }

  async getFollowingWithMutualStatus(userId: number): Promise<{ userId: number; isMutual: boolean }[]> {
    const following = await this.followRepository.find({
      where: { followerId: userId },
      select: ['followingId'],
    });

    const result = await Promise.all(
      following.map(async (f) => {
        const isMutual = await this.isFollowing(f.followingId, userId);
        return { userId: f.followingId, isMutual };
      })
    );

    return result;
  }
}

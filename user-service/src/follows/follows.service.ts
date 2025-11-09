import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Follow } from '../entities/follow.entity';

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(Follow)
    private followRepository: Repository<Follow>,
    private configService: ConfigService,
    private httpService: HttpService,
  ) {}

  async toggleFollow(followerId: number, followingId: number): Promise<{ following: boolean }> {
    if (followerId === followingId) {
      throw new Error('Cannot follow yourself');
    }

    const existingFollow = await this.followRepository.findOne({
      where: { followerId, followingId },
    });

    if (existingFollow) {
      await this.followRepository.remove(existingFollow);
      return { following: false };
    } else {
      const newFollow = this.followRepository.create({ followerId, followingId });
      await this.followRepository.save(newFollow);

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

  async getFollowing(userId: number): Promise<number[]> {
    const follows = await this.followRepository.find({
      where: { followerId: userId },
      select: ['followingId'],
    });
    return follows.map(f => f.followingId);
  }
}

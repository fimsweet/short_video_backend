import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Follow } from '../entities/follow.entity';

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(Follow)
    private followRepository: Repository<Follow>,
  ) {}

  async toggleFollow(followerId: number, followingId: number): Promise<{ following: boolean; followerCount: number }> {
    // Cannot follow yourself
    if (followerId === followingId) {
      throw new Error('Cannot follow yourself');
    }

    const existingFollow = await this.followRepository.findOne({
      where: { followerId, followingId },
    });

    if (existingFollow) {
      // Unfollow
      await this.followRepository.remove(existingFollow);
      const followerCount = await this.getFollowerCount(followingId);
      return { following: false, followerCount };
    } else {
      // Follow
      await this.followRepository.save({ followerId, followingId });
      const followerCount = await this.getFollowerCount(followingId);
      return { following: true, followerCount };
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

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Follow } from '../entities/follow.entity';
import { User } from '../entities/user.entity';
import { ActivityHistoryService } from '../activity-history/activity-history.service';

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(Follow)
    private followRepository: Repository<Follow>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
    private httpService: HttpService,
    private activityHistoryService: ActivityHistoryService,
  ) { }

  async toggleFollow(followerId: number, followingId: number): Promise<{ following: boolean }> {
    if (followerId === followingId) {
      throw new Error('Cannot follow yourself');
    }

    // Get target user info for activity log
    const targetUser = await this.userRepository.findOne({ 
      where: { id: followingId },
      select: ['id', 'username', 'avatar', 'fullName']
    });

    const existingFollow = await this.followRepository.findOne({
      where: { followerId, followingId },
    });

    if (existingFollow) {
      await this.followRepository.remove(existingFollow);

      // Log unfollow activity with user details
      try {
        await this.activityHistoryService.logActivity({
          userId: followerId,
          actionType: 'unfollow',
          targetId: followingId.toString(),
          targetType: 'user',
          metadata: targetUser ? {
            targetUsername: targetUser.username,
            targetAvatar: targetUser.avatar,
            targetFullName: targetUser.fullName,
          } : {},
        });
      } catch (e) {
        console.error('Error logging unfollow activity:', e);
      }

      return { following: false };
    } else {
      const newFollow = this.followRepository.create({ followerId, followingId });
      await this.followRepository.save(newFollow);

      // Log follow activity with user details
      try {
        await this.activityHistoryService.logActivity({
          userId: followerId,
          actionType: 'follow',
          targetId: followingId.toString(),
          targetType: 'user',
          metadata: targetUser ? {
            targetUsername: targetUser.username,
            targetAvatar: targetUser.avatar,
            targetFullName: targetUser.fullName,
          } : {},
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

  async getFollowersWithMutualStatus(
    userId: number, 
    limit: number = 20, 
    offset: number = 0
  ): Promise<{ data: { userId: number; isMutual: boolean }[]; hasMore: boolean; total: number }> {
    // Get total count
    const total = await this.followRepository.count({ where: { followingId: userId } });
    
    // Get paginated followers
    const followers = await this.followRepository.find({
      where: { followingId: userId },
      select: ['followerId'],
      skip: offset,
      take: limit,
    });

    const result = await Promise.all(
      followers.map(async (f) => {
        const isMutual = await this.isFollowing(userId, f.followerId);
        return { userId: f.followerId, isMutual };
      })
    );

    return {
      data: result,
      hasMore: offset + followers.length < total,
      total,
    };
  }

  async getFollowing(userId: number): Promise<number[]> {
    const follows = await this.followRepository.find({
      where: { followerId: userId },
      select: ['followingId'],
    });
    return follows.map(f => f.followingId);
  }

  async getFollowingWithMutualStatus(
    userId: number, 
    limit: number = 20, 
    offset: number = 0
  ): Promise<{ data: { userId: number; isMutual: boolean }[]; hasMore: boolean; total: number }> {
    // Get total count
    const total = await this.followRepository.count({ where: { followerId: userId } });
    
    // Get paginated following
    const following = await this.followRepository.find({
      where: { followerId: userId },
      select: ['followingId'],
      skip: offset,
      take: limit,
    });

    const result = await Promise.all(
      following.map(async (f) => {
        const isMutual = await this.isFollowing(f.followingId, userId);
        return { userId: f.followingId, isMutual };
      })
    );

    return {
      data: result,
      hasMore: offset + following.length < total,
      total,
    };
  }

  /**
   * Get suggested users to follow based on multiple criteria:
   * 1. Friends of friends (people followed by people you follow)
   * 2. Popular users (most followers)
   * 3. Recently active users
   * 4. Users not already followed
   */
  async getSuggestions(userId: number, limit: number = 10): Promise<{
    id: number;
    username: string;
    fullName: string | null;
    avatar: string | null;
    followerCount: number;
    mutualFriendsCount: number;
    reason: string;
  }[]> {
    // Get users the current user is already following
    const followingIds = await this.getFollowing(userId);
    const excludeIds = [userId, ...followingIds];

    // 1. Get friends of friends (people followed by people you follow)
    const friendsOfFriends = await this.followRepository
      .createQueryBuilder('f')
      .select('f.followingId', 'userId')
      .addSelect('COUNT(DISTINCT f.followerId)', 'mutualCount')
      .where('f.followerId IN (:...followingIds)', { followingIds: followingIds.length > 0 ? followingIds : [0] })
      .andWhere('f.followingId NOT IN (:...excludeIds)', { excludeIds })
      .groupBy('f.followingId')
      .orderBy('mutualCount', 'DESC')
      .limit(limit)
      .getRawMany();

    // 2. Get popular users (most followers)
    const popularUsers = await this.followRepository
      .createQueryBuilder('f')
      .select('f.followingId', 'userId')
      .addSelect('COUNT(*)', 'followerCount')
      .where('f.followingId NOT IN (:...excludeIds)', { excludeIds })
      .groupBy('f.followingId')
      .orderBy('followerCount', 'DESC')
      .limit(limit)
      .getRawMany();

    // Combine and deduplicate suggestions
    const suggestionMap = new Map<number, { mutualCount: number; followerCount: number; reason: string }>();

    // Add friends of friends
    for (const fof of friendsOfFriends) {
      const uid = parseInt(fof.userId);
      if (!suggestionMap.has(uid)) {
        suggestionMap.set(uid, {
          mutualCount: parseInt(fof.mutualCount),
          followerCount: 0,
          reason: 'mutual_friends',
        });
      }
    }

    // Add popular users
    for (const pop of popularUsers) {
      const uid = parseInt(pop.userId);
      if (!suggestionMap.has(uid)) {
        suggestionMap.set(uid, {
          mutualCount: 0,
          followerCount: parseInt(pop.followerCount),
          reason: 'popular',
        });
      } else {
        const existing = suggestionMap.get(uid)!;
        existing.followerCount = parseInt(pop.followerCount);
      }
    }

    // Get user details for all suggestions
    const suggestionIds = Array.from(suggestionMap.keys()).slice(0, limit);
    
    if (suggestionIds.length === 0) {
      // Fallback: get any users not followed
      const fallbackUsers = await this.userRepository
        .createQueryBuilder('u')
        .where('u.id NOT IN (:...excludeIds)', { excludeIds })
        .andWhere('u.isDeactivated = false OR u.isDeactivated IS NULL')
        .orderBy('u.createdAt', 'DESC')
        .limit(limit)
        .getMany();

      return fallbackUsers.map(user => ({
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        followerCount: 0,
        mutualFriendsCount: 0,
        reason: 'suggested',
      }));
    }

    const users = await this.userRepository
      .createQueryBuilder('u')
      .where('u.id IN (:...suggestionIds)', { suggestionIds })
      .andWhere('u.isDeactivated = false OR u.isDeactivated IS NULL')
      .getMany();

    // Build final result with all details
    const result = users.map(user => {
      const suggestion = suggestionMap.get(user.id) || { mutualCount: 0, followerCount: 0, reason: 'suggested' };
      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        followerCount: suggestion.followerCount,
        mutualFriendsCount: suggestion.mutualCount,
        reason: suggestion.reason,
      };
    });

    // Sort by mutual friends first, then by follower count
    result.sort((a, b) => {
      if (a.mutualFriendsCount !== b.mutualFriendsCount) {
        return b.mutualFriendsCount - a.mutualFriendsCount;
      }
      return b.followerCount - a.followerCount;
    });

    return result.slice(0, limit);
  }
}

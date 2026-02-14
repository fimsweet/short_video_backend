import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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
   * 2. Users with similar taste (liked same videos)
   * 3. Creators of videos you liked
   * 4. Popular users (most followers)
   * 5. Users not already followed
   */
  async getSuggestions(userId: number, limit: number = 10): Promise<{
    id: number;
    username: string;
    fullName: string | null;
    avatar: string | null;
    followerCount: number;
    mutualFriendsCount: number;
    reason: string;
    mutualFollowerNames: string[];
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

    // 2. Get users with similar taste and creators of liked videos from video-service
    let similarUsers: { userId: number; commonLikes: number }[] = [];
    let likedCreators: { userId: number; likedVideosCount: number }[] = [];
    
    try {
      const videoServiceUrl = this.configService.get<string>('VIDEO_SERVICE_URL') || 'http://localhost:3001';
      
      // Get users who liked similar videos
      const similarResponse = await firstValueFrom(
        this.httpService.get(`${videoServiceUrl}/likes/similar-users/${userId}`, {
          params: { excludeIds: excludeIds.join(','), limit: limit.toString() }
        })
      );
      similarUsers = similarResponse.data || [];

      // Get creators of videos user liked
      const creatorsResponse = await firstValueFrom(
        this.httpService.get(`${videoServiceUrl}/likes/liked-creators/${userId}`, {
          params: { excludeIds: excludeIds.join(','), limit: limit.toString() }
        })
      );
      likedCreators = creatorsResponse.data || [];
    } catch (e) {
      console.error('Error fetching suggestions from video-service:', e.message);
    }

    // 3. Get popular users (most followers)
    const popularUsers = await this.followRepository
      .createQueryBuilder('f')
      .select('f.followingId', 'userId')
      .addSelect('COUNT(*)', 'followerCount')
      .where('f.followingId NOT IN (:...excludeIds)', { excludeIds })
      .groupBy('f.followingId')
      .orderBy('followerCount', 'DESC')
      .limit(limit)
      .getRawMany();

    // Combine and deduplicate suggestions with scoring
    const suggestionMap = new Map<number, { 
      mutualCount: number; 
      followerCount: number; 
      similarTasteScore: number;
      likedCreatorScore: number;
      reason: string;
      score: number;
      mutualFollowerNames: string[];
    }>();

    // Get mutual follower names for friends-of-friends
    const mutualFollowerNamesMap = new Map<number, string[]>();
    if (friendsOfFriends.length > 0 && followingIds.length > 0) {
      try {
        // Get who follows each suggested user among my followings
        const mutualDetails = await this.followRepository
          .createQueryBuilder('f')
          .select('f.followingId', 'suggestedUserId')
          .addSelect('u.username', 'followerUsername')
          .innerJoin('user', 'u', 'u.id = f.followerId')
          .where('f.followerId IN (:...followingIds)', { followingIds })
          .andWhere('f.followingId IN (:...suggestedIds)', { 
            suggestedIds: friendsOfFriends.map(f => parseInt(f.userId)) 
          })
          .getRawMany();

        for (const detail of mutualDetails) {
          const sid = parseInt(detail.suggestedUserId);
          if (!mutualFollowerNamesMap.has(sid)) {
            mutualFollowerNamesMap.set(sid, []);
          }
          mutualFollowerNamesMap.get(sid)!.push(detail.followerUsername);
        }
      } catch (e) {
        console.error('Error getting mutual follower names:', e.message);
      }
    }

    // Add friends of friends (highest priority - social graph)
    for (const fof of friendsOfFriends) {
      const uid = parseInt(fof.userId);
      const mutualCount = parseInt(fof.mutualCount);
      const names = mutualFollowerNamesMap.get(uid) || [];
      suggestionMap.set(uid, {
        mutualCount,
        followerCount: 0,
        similarTasteScore: 0,
        likedCreatorScore: 0,
        reason: 'mutual_friends',
        score: mutualCount * 100, // High weight for mutual friends
        mutualFollowerNames: names,
      });
    }

    // Add users with similar taste (content graph)
    for (const similar of similarUsers) {
      const uid = similar.userId;
      const existing = suggestionMap.get(uid);
      if (existing) {
        existing.similarTasteScore = similar.commonLikes;
        existing.score += similar.commonLikes * 50;
        if (existing.reason === 'mutual_friends') {
          existing.reason = 'friends_and_similar_taste';
        }
      } else {
        suggestionMap.set(uid, {
          mutualCount: 0,
          followerCount: 0,
          similarTasteScore: similar.commonLikes,
          likedCreatorScore: 0,
          reason: 'similar_taste',
          score: similar.commonLikes * 50,
          mutualFollowerNames: [],
        });
      }
    }

    // Add creators of liked videos
    for (const creator of likedCreators) {
      const uid = creator.userId;
      const existing = suggestionMap.get(uid);
      if (existing) {
        existing.likedCreatorScore = creator.likedVideosCount;
        existing.score += creator.likedVideosCount * 75;
        if (!existing.reason.includes('liked_creator')) {
          existing.reason = existing.reason === 'suggested' ? 'liked_their_content' : existing.reason;
        }
      } else {
        suggestionMap.set(uid, {
          mutualCount: 0,
          followerCount: 0,
          similarTasteScore: 0,
          likedCreatorScore: creator.likedVideosCount,
          reason: 'liked_their_content',
          score: creator.likedVideosCount * 75,
          mutualFollowerNames: [],
        });
      }
    }

    // Add popular users
    for (const pop of popularUsers) {
      const uid = parseInt(pop.userId);
      const followerCount = parseInt(pop.followerCount);
      const existing = suggestionMap.get(uid);
      if (existing) {
        existing.followerCount = followerCount;
        existing.score += Math.min(followerCount, 100) * 10; // Cap popularity score
      } else {
        suggestionMap.set(uid, {
          mutualCount: 0,
          followerCount,
          similarTasteScore: 0,
          likedCreatorScore: 0,
          reason: 'popular',
          score: Math.min(followerCount, 100) * 10,
          mutualFollowerNames: [],
        });
      }
    }

    // Get user details for all suggestions
    const sortedSuggestions = Array.from(suggestionMap.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);
    
    const suggestionIds = sortedSuggestions.map(([id]) => id);
    
    if (suggestionIds.length === 0) {
      // No meaningful suggestions - return empty array
      // Frontend will show appropriate empty state UI
      return [];
    }

    const users = await this.userRepository
      .createQueryBuilder('u')
      .where('u.id IN (:...suggestionIds)', { suggestionIds })
      .andWhere('u.isDeactivated = false OR u.isDeactivated IS NULL')
      .getMany();

    // Build final result with all details, preserving the sorted order
    const userMap = new Map(users.map(u => [u.id, u]));
    const result = sortedSuggestions
      .filter(([id]) => userMap.has(id))
      .map(([id, suggestion]) => {
        const user = userMap.get(id)!;
        return {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          avatar: user.avatar,
          followerCount: suggestion.followerCount,
          mutualFriendsCount: suggestion.mutualCount,
          reason: suggestion.reason,
          mutualFollowerNames: suggestion.mutualFollowerNames.slice(0, 3),
        };
      });

    return result;
  }

  /**
   * Get mutual friends (users where both follow each other)
   * This represents the "Friends" relationship like TikTok
   */
  async getMutualFriends(
    userId: number,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ data: { userId: number; username: string; fullName: string | null; avatar: string | null }[]; hasMore: boolean; total: number }> {
    // Get users that current user follows
    const following = await this.followRepository.find({
      where: { followerId: userId },
      select: ['followingId'],
    });
    const followingIds = following.map(f => f.followingId);

    if (followingIds.length === 0) {
      return { data: [], hasMore: false, total: 0 };
    }

    // Find mutual follows - users who also follow the current user back
    const mutualFollowsQuery = this.followRepository
      .createQueryBuilder('f')
      .where('f.followerId IN (:...followingIds)', { followingIds })
      .andWhere('f.followingId = :userId', { userId });

    const total = await mutualFollowsQuery.getCount();

    const mutualFollows = await this.followRepository
      .createQueryBuilder('f')
      .select('f.followerId', 'userId')
      .where('f.followerId IN (:...followingIds)', { followingIds })
      .andWhere('f.followingId = :userId', { userId })
      .skip(offset)
      .take(limit)
      .getRawMany();

    const mutualUserIds = mutualFollows.map(m => m.userId);

    if (mutualUserIds.length === 0) {
      return { data: [], hasMore: false, total };
    }

    // Get user details
    const users = await this.userRepository.find({
      where: { id: In(mutualUserIds) },
      select: ['id', 'username', 'fullName', 'avatar'],
    });

    const data = users.map(user => ({
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      avatar: user.avatar,
    }));

    return {
      data,
      hasMore: offset + mutualFollows.length < total,
      total,
    };
  }
}

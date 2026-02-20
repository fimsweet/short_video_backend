import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Follow } from '../entities/follow.entity';
import { User } from '../entities/user.entity';
import { UserSettings } from '../entities/user-settings.entity';
import { ActivityHistoryService } from '../activity-history/activity-history.service';

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(Follow)
    private followRepository: Repository<Follow>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserSettings)
    private userSettingsRepository: Repository<UserSettings>,
    private configService: ConfigService,
    private httpService: HttpService,
    private activityHistoryService: ActivityHistoryService,
  ) { }

  async toggleFollow(followerId: number, followingId: number): Promise<{ following: boolean; requested?: boolean; status?: string }> {
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
      // If pending → cancel request; if accepted → unfollow
      const wasPending = existingFollow.status === 'pending';
      await this.followRepository.remove(existingFollow);

      // Log activity
      try {
        await this.activityHistoryService.logActivity({
          userId: followerId,
          actionType: wasPending ? 'cancel_follow_request' : 'unfollow',
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

      return { following: false, requested: false, status: 'none' };
    } else {
      // Check target's requireFollowApproval setting to decide if instant follow or pending request
      const targetSettings = await this.userSettingsRepository.findOne({ where: { userId: followingId } });
      const isPrivateAccount = targetSettings?.requireFollowApproval === true;

      const newFollow = this.followRepository.create({ 
        followerId, 
        followingId,
        status: isPrivateAccount ? 'pending' : 'accepted',
      });
      await this.followRepository.save(newFollow);

      // Log activity
      try {
        await this.activityHistoryService.logActivity({
          userId: followerId,
          actionType: isPrivateAccount ? 'follow_request' : 'follow',
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
        const senderUser = await this.userRepository.findOne({ 
          where: { id: followerId },
          select: ['id', 'username']
        });
        const videoServiceUrl = this.configService.get<string>('VIDEO_SERVICE_URL') || 'http://localhost:3001';
        await firstValueFrom(
          this.httpService.post(`${videoServiceUrl}/notifications/create`, {
            recipientId: followingId.toString(),
            senderId: followerId.toString(),
            type: isPrivateAccount ? 'follow_request' : 'follow',
            senderName: senderUser?.username || 'Người dùng',
          })
        );
      } catch (e) {
        console.error('Error sending follow notification:', e);
      }

      if (isPrivateAccount) {
        return { following: false, requested: true, status: 'pending' };
      }
      return { following: true, requested: false, status: 'accepted' };
    }
  }

  async isFollowing(followerId: number, followingId: number): Promise<boolean> {
    const follow = await this.followRepository.findOne({
      where: { followerId, followingId, status: 'accepted' },
    });
    return !!follow;
  }

  /**
   * Get follow status between two users
   * Returns: 'none', 'pending', 'following'
   */
  async getFollowStatus(followerId: number, followingId: number): Promise<string> {
    const follow = await this.followRepository.findOne({
      where: { followerId, followingId },
    });
    if (!follow) return 'none';
    return follow.status === 'accepted' ? 'following' : 'pending';
  }

  async isMutualFollow(userId1: number, userId2: number): Promise<boolean> {
    const [follow1, follow2] = await Promise.all([
      this.followRepository.findOne({ where: { followerId: userId1, followingId: userId2, status: 'accepted' } }),
      this.followRepository.findOne({ where: { followerId: userId2, followingId: userId1, status: 'accepted' } }),
    ]);
    return !!follow1 && !!follow2;
  }

  async getFollowerCount(userId: number): Promise<number> {
    return this.followRepository.count({ where: { followingId: userId, status: 'accepted' } });
  }

  async getFollowingCount(userId: number): Promise<number> {
    return this.followRepository.count({ where: { followerId: userId, status: 'accepted' } });
  }

  async getFollowers(userId: number): Promise<number[]> {
    const follows = await this.followRepository.find({
      where: { followingId: userId, status: 'accepted' },
      select: ['followerId'],
    });
    return follows.map(f => f.followerId);
  }

  async getFollowersWithMutualStatus(
    userId: number, 
    limit: number = 20, 
    offset: number = 0
  ): Promise<{ data: { userId: number; isMutual: boolean }[]; hasMore: boolean; total: number }> {
    // Get total count (only accepted follows)
    const total = await this.followRepository.count({ where: { followingId: userId, status: 'accepted' } });
    
    // Get paginated followers (only accepted)
    const followers = await this.followRepository.find({
      where: { followingId: userId, status: 'accepted' },
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
      where: { followerId: userId, status: 'accepted' },
      select: ['followingId'],
    });
    return follows.map(f => f.followingId);
  }

  async getFollowingWithMutualStatus(
    userId: number, 
    limit: number = 20, 
    offset: number = 0
  ): Promise<{ data: { userId: number; isMutual: boolean }[]; hasMore: boolean; total: number }> {
    // Get total count (only accepted follows)
    const total = await this.followRepository.count({ where: { followerId: userId, status: 'accepted' } });
    
    // Get paginated following (only accepted)
    const following = await this.followRepository.find({
      where: { followerId: userId, status: 'accepted' },
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
      .andWhere('f.status = :status', { status: 'accepted' })
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
      .andWhere('f.status = :status', { status: 'accepted' })
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
    // Get users that current user follows (only accepted)
    const following = await this.followRepository.find({
      where: { followerId: userId, status: 'accepted' },
      select: ['followingId'],
    });
    const followingIds = following.map(f => f.followingId);

    if (followingIds.length === 0) {
      return { data: [], hasMore: false, total: 0 };
    }

    // Find mutual follows - users who also follow the current user back (both accepted)
    const mutualFollowsQuery = this.followRepository
      .createQueryBuilder('f')
      .where('f.followerId IN (:...followingIds)', { followingIds })
      .andWhere('f.followingId = :userId', { userId })
      .andWhere('f.status = :status', { status: 'accepted' });

    const total = await mutualFollowsQuery.getCount();

    const mutualFollows = await this.followRepository
      .createQueryBuilder('f')
      .select('f.followerId', 'userId')
      .where('f.followerId IN (:...followingIds)', { followingIds })
      .andWhere('f.followingId = :userId', { userId })
      .andWhere('f.status = :status', { status: 'accepted' })
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

  // Check if a requester can view a user's follower/following/liked list
  async checkListPrivacy(
    targetUserId: number,
    requesterId: number | undefined,
    listType: 'followers' | 'following' | 'likedVideos',
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Self-view always allowed
    if (requesterId && requesterId === targetUserId) {
      return { allowed: true };
    }

    const settings = await this.userSettingsRepository.findOne({ where: { userId: targetUserId } });
    if (!settings) return { allowed: true };

    let settingValue: string;
    switch (listType) {
      case 'followers':
        settingValue = settings.whoCanViewFollowersList || 'everyone';
        break;
      case 'following':
        settingValue = settings.whoCanViewFollowingList || 'everyone';
        break;
      case 'likedVideos':
        settingValue = settings.whoCanViewLikedVideos || 'everyone';
        break;
      default:
        return { allowed: true };
    }

    if (settingValue === 'everyone') return { allowed: true };

    if (!requesterId) {
      return { allowed: false, reason: 'login_required' };
    }

    if (settingValue === 'friends') {
      const isFriend = await this.isMutualFollow(targetUserId, requesterId);
      if (isFriend) return { allowed: true };
      return { allowed: false, reason: 'friends_only' };
    }

    if (settingValue === 'onlyMe') {
      return { allowed: false, reason: 'private' };
    }

    return { allowed: true };
  }

  // ===================== FOLLOW REQUEST METHODS =====================

  /**
   * Get pending incoming follow requests for a user
   */
  async getPendingFollowRequests(
    userId: number,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ data: { userId: number; username: string; fullName: string | null; avatar: string | null; requestedAt: Date }[]; hasMore: boolean; total: number }> {
    const total = await this.followRepository.count({ where: { followingId: userId, status: 'pending' } });

    const requests = await this.followRepository.find({
      where: { followingId: userId, status: 'pending' },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    if (requests.length === 0) {
      return { data: [], hasMore: false, total };
    }

    const requesterIds = requests.map(r => r.followerId);
    const users = await this.userRepository.find({
      where: { id: In(requesterIds) },
      select: ['id', 'username', 'fullName', 'avatar'],
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const data = requests
      .filter(r => userMap.has(r.followerId))
      .map(r => {
        const user = userMap.get(r.followerId)!;
        return {
          userId: user.id,
          username: user.username,
          fullName: user.fullName,
          avatar: user.avatar,
          requestedAt: r.createdAt,
        };
      });

    return {
      data,
      hasMore: offset + requests.length < total,
      total,
    };
  }

  /**
   * Get count of pending follow requests
   */
  async getPendingRequestCount(userId: number): Promise<number> {
    return this.followRepository.count({ where: { followingId: userId, status: 'pending' } });
  }

  /**
   * Approve a follow request
   */
  async approveFollowRequest(followerId: number, followingId: number): Promise<{ success: boolean }> {
    const follow = await this.followRepository.findOne({
      where: { followerId, followingId, status: 'pending' },
    });

    if (!follow) {
      throw new Error('Follow request not found');
    }

    follow.status = 'accepted';
    await this.followRepository.save(follow);

    // Log activity
    try {
      const requester = await this.userRepository.findOne({ 
        where: { id: followerId },
        select: ['id', 'username', 'avatar', 'fullName']
      });
      await this.activityHistoryService.logActivity({
        userId: followingId,
        actionType: 'approve_follow_request',
        targetId: followerId.toString(),
        targetType: 'user',
        metadata: requester ? {
          targetUsername: requester.username,
          targetAvatar: requester.avatar,
          targetFullName: requester.fullName,
        } : {},
      });
    } catch (e) {
      console.error('Error logging approve activity:', e);
    }

    // Send notification: "X accepted your follow request"
    try {
      const accepter = await this.userRepository.findOne({ 
        where: { id: followingId },
        select: ['id', 'username']
      });
      const videoServiceUrl = this.configService.get<string>('VIDEO_SERVICE_URL') || 'http://localhost:3001';
      await firstValueFrom(
        this.httpService.post(`${videoServiceUrl}/notifications/create`, {
          recipientId: followerId.toString(),
          senderId: followingId.toString(),
          type: 'follow_request_accepted',
          senderName: accepter?.username || 'Người dùng',
        })
      );
    } catch (e) {
      console.error('Error sending follow request accepted notification:', e);
    }

    return { success: true };
  }

  /**
   * Reject a follow request (deletes the record)
   */
  async rejectFollowRequest(followerId: number, followingId: number): Promise<{ success: boolean }> {
    const follow = await this.followRepository.findOne({
      where: { followerId, followingId, status: 'pending' },
    });

    if (!follow) {
      throw new Error('Follow request not found');
    }

    await this.followRepository.remove(follow);

    // Log activity
    try {
      await this.activityHistoryService.logActivity({
        userId: followingId,
        actionType: 'reject_follow_request',
        targetId: followerId.toString(),
        targetType: 'user',
        metadata: {},
      });
    } catch (e) {
      console.error('Error logging reject activity:', e);
    }

    return { success: true };
  }
}

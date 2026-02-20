import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Video, VideoStatus, VideoVisibility } from '../entities/video.entity';
import { VideoCategory } from '../entities/video-category.entity';
import { Like } from '../entities/like.entity';
import { LikesService } from '../likes/likes.service';
import { CommentsService } from '../comments/comments.service';
import { SavedVideosService } from '../saved-videos/saved-videos.service';
import { SharesService } from '../shares/shares.service';
import { CategoriesService } from '../categories/categories.service';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { PrivacyService } from '../config/privacy.service';

interface UserInterest {
  categoryId: number;
  categoryName: string;
  weight: number;
}

interface ScoredVideo {
  video: Video;
  score: number;
  matchedCategories: number[];
}

// Algorithm weights - tunable parameters
const WEIGHTS = {
  INTEREST_MATCH: 0.30, // From user interests + watch time
  ENGAGEMENT: 0.25,      // Likes, views ratio
  RECENCY: 0.20,         // Newer videos preferred
  EXPLORATION: 0.15,     // Random factor for discovery of new categories
  FRESHNESS: 0.10,       // Bonus for videos user hasn't seen
};

// Discovery ratio: ensure ~20% of feed is from unexplored categories
const DISCOVERY_RATIO = 0.20;

// How many recently watched videos to completely exclude (not just penalize)
const EXCLUDE_RECENTLY_WATCHED = 50;

@Injectable()
export class RecommendationService {
  constructor(
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
    @InjectRepository(VideoCategory)
    private videoCategoryRepository: Repository<VideoCategory>,
    @InjectRepository(Like)
    private likeRepository: Repository<Like>,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @Inject(forwardRef(() => LikesService))
    private likesService: LikesService,
    @Inject(forwardRef(() => CommentsService))
    private commentsService: CommentsService,
    @Inject(forwardRef(() => SavedVideosService))
    private savedVideosService: SavedVideosService,
    @Inject(forwardRef(() => SharesService))
    private sharesService: SharesService,
    private categoriesService: CategoriesService,
    private httpService: HttpService,
    @Inject(forwardRef(() => WatchHistoryService))
    private watchHistoryService: WatchHistoryService,
    private privacyService: PrivacyService,
  ) {}

  /**
   * Get personalized video recommendations for a user
   * 
   * Algorithm: Hybrid (Content-Based + Watch Time + Engagement + Recency + Exploration)
   * 
   * Score = (Interest Match × 0.30) + (Engagement × 0.25) + (Recency × 0.20) + (Exploration × 0.15) + (Freshness × 0.10)
   * 
   * Interest Match includes:
   * - Explicit interests (user selected)
   * - Implicit from likes
   * - Implicit from watch time (NEW - most important signal)
   */
  async getRecommendedVideos(userId: number, limit: number = 50, excludeIds: string[] = []): Promise<any[]> {
    // If excludeIds provided (refresh), skip cache to get fresh results
    const skipCache = excludeIds.length > 0;
    const cacheKey = `recommendations:${userId}:${limit}`;
    
    if (!skipCache) {
      // Check cache first (shorter TTL for personalized content)
      const cached = await this.cacheManager.get(cacheKey);
      if (cached) {
        console.log(`Cache HIT for user ${userId} recommendations`);
        return cached as any[];
      }
    } else {
      // Invalidate old cache when refreshing
      await this.cacheManager.del(cacheKey);
      console.log(`Cache SKIPPED for user ${userId} (refresh with ${excludeIds.length} excluded videos)`);
    }

    console.log(`Generating recommendations for user ${userId}...`);

    try {
      // 1. Get user interests from user-service (explicit)
      const userInterests = await this.getUserInterests(userId);
      console.log(`   Explicit interests: ${userInterests.map(i => i.categoryName).join(', ') || 'None'}`);

      // 2. Get implicit interests from liked videos
      const likeBasedInterests = await this.getImplicitInterests(userId);
      console.log(`   Like-based interests: ${likeBasedInterests.map(i => i.categoryName).join(', ') || 'None'}`);

      // 3. Get watch-time based interests (NEW - most important signal)
      const watchTimeInterests = await this.getWatchTimeInterests(userId);
      console.log(`   Watch-time interests: ${watchTimeInterests.map(i => i.categoryName).join(', ') || 'None'}`);

      // 4. Merge all interests with different weights
      const allInterests = this.mergeAllInterests(userInterests, likeBasedInterests, watchTimeInterests);
      console.log(`   Merged interests: ${allInterests.slice(0, 5).map(i => `${i.categoryName}(${i.weight.toFixed(2)})`).join(', ')}`);

      // 5. Get videos user has already watched (to filter or deprioritize)
      const watchedVideoIds = await this.watchHistoryService.getWatchedVideoIds(userId.toString(), 100);
      
      // Recently watched videos (first N) should be COMPLETELY excluded
      const recentlyWatchedSet = new Set(watchedVideoIds.slice(0, EXCLUDE_RECENTLY_WATCHED));
      const olderWatchedSet = new Set(watchedVideoIds.slice(EXCLUDE_RECENTLY_WATCHED));
      
      // Also exclude explicitly passed IDs (from frontend refresh - videos user already saw in feed)
      for (const id of excludeIds) {
        recentlyWatchedSet.add(id);
      }
      
      console.log(`   Excluding ${recentlyWatchedSet.size} recently watched/seen videos, deprioritizing ${olderWatchedSet.size} older watched`);

      // 6a. Get following + mutual-friend user IDs to exclude from recommendations
      // Their videos should only appear in the "Following" and "Friends" tabs
      const excludeUserIds: string[] = [userId.toString()];
      try {
        const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
        
        const [followingRes, mutualRes] = await Promise.all([
          firstValueFrom(this.httpService.get(`${userServiceUrl}/follows/following/${userId}`)),
          firstValueFrom(this.httpService.get(`${userServiceUrl}/follows/mutual-friends/${userId}?limit=1000`)),
        ]);
        
        const followingIds: number[] = followingRes.data.followingIds || [];
        const mutualFriendIds: number[] = (mutualRes.data.data || []).map((f: any) => f.userId);
        
        // Merge both sets (mutual friends are a subset of following, but be safe)
        const allExcluded = new Set<string>();
        allExcluded.add(userId.toString());
        for (const id of followingIds) allExcluded.add(id.toString());
        for (const id of mutualFriendIds) allExcluded.add(id.toString());
        
        excludeUserIds.length = 0;
        excludeUserIds.push(...allExcluded);
        
        console.log(`   Excluding ${followingIds.length} following + ${mutualFriendIds.length} mutual friends (${allExcluded.size} unique users) from recommendations`);
      } catch (err) {
        console.warn('   Failed to fetch following/friends for exclusion, falling back to self-only exclusion:', err.message);
      }

      // 6b. Get all ready, non-hidden, PUBLIC videos EXCLUDING own + following + friends
      const queryBuilder = this.videoRepository.createQueryBuilder('video')
        .where('video.status = :status', { status: VideoStatus.READY })
        .andWhere('video.isHidden = :isHidden', { isHidden: false })
        .andWhere('video.visibility = :visibility', { visibility: VideoVisibility.PUBLIC })
        .andWhere('video.userId NOT IN (:...excludeUserIds)', { excludeUserIds })
        .orderBy('video.createdAt', 'DESC')
        .take(limit * 4);
      
      const allVideos = await queryBuilder.getMany();

      if (allVideos.length === 0) {
        return [];
      }
      
      // 6.5 Filter out recently watched videos completely
      const filteredVideos = allVideos.filter(v => !recentlyWatchedSet.has(v.id));
      console.log(`   Videos after filtering recently watched: ${filteredVideos.length}/${allVideos.length}`);

      // 6.6 [PRIVACY] Filter out videos from private accounts and restricted users
      const privacyFiltered = await this.privacyService.filterVideosByPrivacy(filteredVideos, userId.toString());
      console.log(`   Videos after privacy filter: ${privacyFiltered.length}/${filteredVideos.length}`);

      // 7. Get all categories user has interacted with (for discovery detection)
      const exploredCategoryIds = new Set(allInterests.map(i => i.categoryId));

      // 8. Score each video with new algorithm (pass older watched set for penalizing)
      const scoredVideos = await this.scoreVideosAdvanced(privacyFiltered, allInterests, userId, Array.from(olderWatchedSet));

      // 9. Sort by score (highest first)
      scoredVideos.sort((a, b) => b.score - a.score);

      // 10. Apply discovery mixing — ensure ~20% are from unexplored categories
      const topVideos = this.applyDiscoveryMixing(scoredVideos, exploredCategoryIds, limit);

      // 11. Apply diversity shuffle — avoid too many same-category videos in a row
      const diverseVideos = this.applyDiversityShuffle(topVideos);

      // 12. Add engagement counts
      const videosWithCounts = await this.addEngagementCounts(diverseVideos.map(sv => sv.video));

      console.log(`Generated ${videosWithCounts.length} recommendations for user ${userId}`);
      console.log(`   Algorithm weights: Interest=${WEIGHTS.INTEREST_MATCH}, Engagement=${WEIGHTS.ENGAGEMENT}, Recency=${WEIGHTS.RECENCY}, Exploration=${WEIGHTS.EXPLORATION}, Freshness=${WEIGHTS.FRESHNESS}`);
      console.log(`   Discovery ratio target: ${DISCOVERY_RATIO * 100}%`);

      // Cache for 90 seconds (shorter for active users to get fresh content)
      const cacheTTL = watchedVideoIds.length > 20 ? 60000 : 120000;
      await this.cacheManager.set(cacheKey, videosWithCounts, cacheTTL);

      return videosWithCounts;
    } catch (error) {
      console.error('Error generating recommendations:', error);
      // Fallback to chronological feed
      return this.getFallbackVideos(limit);
    }
  }

  /**
   * Get user interests from user-service
   */
  private async getUserInterests(userId: number): Promise<UserInterest[]> {
    try {
      const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
      const response = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/users/${userId}/interests`)
      );
      return response.data.data || [];
    } catch (error) {
      console.log(`Could not fetch user interests: ${error.message}`);
      return [];
    }
  }

  /**
   * Get implicit interests from user's liked videos
   */
  private async getImplicitInterests(userId: number): Promise<UserInterest[]> {
    try {
      // Get user's liked video IDs
      const likes = await this.likeRepository.find({
        where: { userId: userId.toString() },
        order: { createdAt: 'DESC' },
        take: 50, // Last 50 liked videos
      });

      if (likes.length === 0) return [];

      const videoIds = likes.map(l => l.videoId);

      // Get categories of liked videos
      const videoCategories = await this.videoCategoryRepository.find({
        where: { videoId: In(videoIds) },
        relations: ['category'],
      });

      // Count category occurrences
      const categoryCount: Map<number, { name: string; count: number }> = new Map();
      for (const vc of videoCategories) {
        if (vc.category) {
          const existing = categoryCount.get(vc.categoryId) || { name: vc.category.displayName, count: 0 };
          existing.count++;
          categoryCount.set(vc.categoryId, existing);
        }
      }

      // Convert to interests with weight based on frequency
      const maxCount = Math.max(...Array.from(categoryCount.values()).map(v => v.count));
      const interests: UserInterest[] = [];
      
      categoryCount.forEach((value, categoryId) => {
        interests.push({
          categoryId,
          categoryName: value.name,
          weight: value.count / maxCount, // Normalize weight 0-1
        });
      });

      return interests;
    } catch (error) {
      console.log(`Could not calculate implicit interests: ${error.message}`);
      return [];
    }
  }

  /**
   * Get interests from watch time (NEW)
   */
  private async getWatchTimeInterests(userId: number): Promise<UserInterest[]> {
    try {
      const watchInterests = await this.watchHistoryService.getWatchTimeBasedInterests(userId.toString());
      return watchInterests.map(wi => ({
        categoryId: wi.categoryId,
        categoryName: wi.categoryName,
        weight: wi.weight,
      }));
    } catch (error) {
      console.log(`Could not get watch time interests: ${error.message}`);
      return [];
    }
  }

  /**
   * Merge all interest sources with different weights
   * Priority: Watch Time > Explicit > Likes
   */
  private mergeAllInterests(
    explicit: UserInterest[],
    likeBased: UserInterest[],
    watchTime: UserInterest[],
  ): UserInterest[] {
    const merged: Map<number, UserInterest> = new Map();

    // Watch time interests get highest weight (most reliable signal)
    for (const interest of watchTime) {
      merged.set(interest.categoryId, {
        ...interest,
        weight: interest.weight * 1.5, // 50% boost for watch time
      });
    }

    // Explicit interests (user selected)
    for (const interest of explicit) {
      const existing = merged.get(interest.categoryId);
      if (existing) {
        existing.weight += interest.weight * 1.3; // Combine with boost
      } else {
        merged.set(interest.categoryId, {
          ...interest,
          weight: interest.weight * 1.3,
        });
      }
    }

    // Like-based interests (lower weight)
    for (const interest of likeBased) {
      const existing = merged.get(interest.categoryId);
      if (existing) {
        existing.weight += interest.weight * 0.8;
      } else {
        merged.set(interest.categoryId, {
          ...interest,
          weight: interest.weight * 0.8,
        });
      }
    }

    // Normalize and sort
    const interests = Array.from(merged.values());
    const maxWeight = Math.max(...interests.map(i => i.weight), 1);
    for (const interest of interests) {
      interest.weight = interest.weight / maxWeight;
    }

    return interests.sort((a, b) => b.weight - a.weight);
  }

  /**
   * Score videos with advanced algorithm
   */
  private async scoreVideosAdvanced(
    videos: Video[],
    interests: UserInterest[],
    userId: number,
    watchedVideoIds: string[],
  ): Promise<ScoredVideo[]> {
    const now = new Date();
    const scoredVideos: ScoredVideo[] = [];
    const watchedSet = new Set(watchedVideoIds);

    // Pre-fetch all video categories
    const videoIds = videos.map(v => v.id);
    const allVideoCategories = await this.videoCategoryRepository.find({
      where: { videoId: In(videoIds) },
    });

    // Create a map of videoId -> categoryIds
    const videoCategoryMap: Map<string, number[]> = new Map();
    for (const vc of allVideoCategories) {
      const categories = videoCategoryMap.get(vc.videoId) || [];
      categories.push(vc.categoryId);
      videoCategoryMap.set(vc.videoId, categories);
    }

    // Create interest lookup map
    const interestMap: Map<number, number> = new Map();
    for (const interest of interests) {
      interestMap.set(interest.categoryId, interest.weight);
    }

    for (const video of videos) {
      const videoCategories = videoCategoryMap.get(video.id) || [];
      let score = 0;
      const matchedCategories: number[] = [];

      // 1. Interest Match Score (0.35)
      let interestScore = 0;
      for (const categoryId of videoCategories) {
        const weight = interestMap.get(categoryId);
        if (weight) {
          interestScore += weight;
          matchedCategories.push(categoryId);
        }
      }
      // Normalize interest score (max 1)
      interestScore = Math.min(interestScore / Math.max(interests.length, 1), 1);
      score += interestScore * WEIGHTS.INTEREST_MATCH;

      // 2. Engagement Score (0.25) — views + like ratio
      const engagementScore = await this.calculateEngagementScore(video);
      score += engagementScore * WEIGHTS.ENGAGEMENT;

      // 3. Recency Score (0.20) - Videos from last 7 days get higher scores
      const ageInDays = (now.getTime() - new Date(video.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - (ageInDays / 7)); // Linear decay over 7 days
      score += recencyScore * WEIGHTS.RECENCY;

      // 4. Exploration/Random Score (0.15) - Discovery of new categories
      // Use hash-based pseudo-random for deterministic scoring within a session
      const hashSeed = (video.id.charCodeAt(0) * 31 + video.id.charCodeAt(video.id.length - 1) + userId) % 100;
      let explorationScore = hashSeed / 200; // 0-0.5 deterministic factor
      if (videoCategories.length > 0 && matchedCategories.length === 0) {
        // Strong boost for videos from completely unexplored categories
        explorationScore = Math.min(explorationScore + 0.6, 1);
      } else if (videoCategories.length > 0 && matchedCategories.length < videoCategories.length) {
        // Moderate boost for videos that have at least one unexplored category
        explorationScore = Math.min(explorationScore + 0.3, 1);
      }
      score += explorationScore * WEIGHTS.EXPLORATION;

      // 5. Freshness Score (0.05) - Bonus for videos user hasn't seen
      const freshnessScore = watchedSet.has(video.id) ? 0 : 1;
      score += freshnessScore * WEIGHTS.FRESHNESS;

      scoredVideos.push({
        video,
        score,
        matchedCategories,
      });
    }

    return scoredVideos;
  }

  /**
   * Ensure a percentage of the feed comes from unexplored categories
   * This prevents filter bubbles and helps users discover new content
   */
  private applyDiscoveryMixing(
    scoredVideos: ScoredVideo[],
    exploredCategoryIds: Set<number>,
    limit: number,
  ): ScoredVideo[] {
    const discoverySlots = Math.ceil(limit * DISCOVERY_RATIO);
    const mainSlots = limit - discoverySlots;

    // Separate videos into "familiar" and "discovery" pools
    const familiarVideos: ScoredVideo[] = [];
    const discoveryVideos: ScoredVideo[] = [];

    for (const sv of scoredVideos) {
      // A video is "discovery" if it has NO matched categories with user interests
      if (sv.matchedCategories.length === 0) {
        discoveryVideos.push(sv);
      } else {
        familiarVideos.push(sv);
      }
    }

    console.log(`   Discovery mixing: ${familiarVideos.length} familiar, ${discoveryVideos.length} discovery candidates`);

    // Take from each pool
    const selectedFamiliar = familiarVideos.slice(0, mainSlots);
    const selectedDiscovery = discoveryVideos.slice(0, discoverySlots);

    // If we don't have enough discovery videos, fill with familiar ones
    const result = [...selectedFamiliar, ...selectedDiscovery];
    if (result.length < limit) {
      const remaining = scoredVideos.filter(
        sv => !result.includes(sv),
      ).slice(0, limit - result.length);
      result.push(...remaining);
    }

    return result.slice(0, limit);
  }

  /**
   * Shuffle to avoid consecutive videos from the same category
   * Maintains overall ranking quality while improving diversity
   */
  private applyDiversityShuffle(scoredVideos: ScoredVideo[]): ScoredVideo[] {
    if (scoredVideos.length <= 2) return scoredVideos;

    const result: ScoredVideo[] = [scoredVideos[0]]; // Keep #1 as-is
    const remaining = scoredVideos.slice(1);

    while (remaining.length > 0) {
      const lastVideo = result[result.length - 1];
      const lastCategories = new Set(lastVideo.matchedCategories);

      // Try to find a video with different categories
      let bestIdx = 0;
      let found = false;

      // Look within the next 5 candidates for a different category
      const lookAhead = Math.min(5, remaining.length);
      for (let i = 0; i < lookAhead; i++) {
        const candidateCategories = remaining[i].matchedCategories;
        const hasOverlap = candidateCategories.some(c => lastCategories.has(c));
        if (!hasOverlap) {
          bestIdx = i;
          found = true;
          break;
        }
      }

      // If no different category found in look-ahead window, just take the next best
      if (!found) {
        bestIdx = 0;
      }

      result.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }

    return result;
  }

  /**
   * Merge explicit and implicit interests (legacy method for compatibility)
   */
  private mergeInterests(explicit: UserInterest[], implicit: UserInterest[]): UserInterest[] {
    return this.mergeAllInterests(explicit, implicit, []);
  }

  /**
   * Score videos based on multiple factors (legacy method)
   */
  private async scoreVideos(
    videos: Video[],
    interests: UserInterest[],
    userId: number,
  ): Promise<ScoredVideo[]> {
    return this.scoreVideosAdvanced(videos, interests, userId, []);
  }

  /**
   * Calculate engagement score based on views + like-to-view ratio
   */
  private async calculateEngagementScore(video: Video): Promise<number> {
    const viewCount = video.viewCount || 1;
    // Normalize view count (log scale to handle viral videos)
    const normalizedViews = Math.log10(viewCount + 1) / 6; // Assume 1M views = max
    const viewScore = Math.min(normalizedViews, 1);

    // Like-to-view ratio as quality signal
    const likeCount = await this.likesService.getLikeCount(video.id);
    const likeRatio = viewCount > 0 ? Math.min(likeCount / viewCount, 1) : 0;

    // Blend: 60% view popularity + 40% like quality
    return viewScore * 0.6 + likeRatio * 0.4;
  }

  /**
   * Add engagement counts to videos
   */
  private async addEngagementCounts(videos: Video[]): Promise<any[]> {
    return Promise.all(
      videos.map(async (video) => {
        const likeCount = await this.likesService.getLikeCount(video.id);
        const commentCount = await this.commentsService.getCommentCount(video.id);
        const saveCount = await this.savedVideosService.getSaveCount(video.id);
        const shareCount = await this.sharesService.getShareCount(video.id);
        const categories = await this.categoriesService.getVideoCategories(video.id);

        return {
          ...video,
          likeCount,
          commentCount,
          saveCount,
          shareCount,
          categories,
        };
      }),
    );
  }

  /**
   * Fallback to chronological feed when recommendation fails
   */
  private async getFallbackVideos(limit: number): Promise<any[]> {
    const videos = await this.videoRepository.find({
      where: {
        status: VideoStatus.READY,
        isHidden: false,
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return this.addEngagementCounts(videos);
  }

  /**
   * Get videos for new users (no interests selected yet)
   * Shows trending/popular videos
   */
  async getTrendingVideos(limit: number = 50): Promise<any[]> {
    const cacheKey = `trending:${limit}`;
    
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as any[];
    }

    console.log('Fetching trending videos...');

    // Get videos sorted by engagement (view count for now)
    const videos = await this.videoRepository.find({
      where: {
        status: VideoStatus.READY,
        isHidden: false,
      },
      order: { viewCount: 'DESC', createdAt: 'DESC' },
      take: limit,
    });

    const videosWithCounts = await this.addEngagementCounts(videos);

    // Cache for 5 minutes
    await this.cacheManager.set(cacheKey, videosWithCounts, 300000);

    return videosWithCounts;
  }

  /**
   * Get videos by category
   */
  async getVideosByCategory(categoryId: number, limit: number = 50): Promise<any[]> {
    const videoIds = await this.categoriesService.getVideoIdsByCategory(categoryId, limit);
    
    if (videoIds.length === 0) return [];

    const videos = await this.videoRepository.find({
      where: {
        id: In(videoIds),
        status: VideoStatus.READY,
        isHidden: false,
      },
      order: { createdAt: 'DESC' },
    });

    return this.addEngagementCounts(videos);
  }

  /**
   * Invalidate user's recommendation cache (call when user likes/saves a video)
   */
  async invalidateUserCache(userId: number): Promise<void> {
    const cacheKey = `recommendations:${userId}:*`;
    // Simple invalidation - just delete the default key
    await this.cacheManager.del(`recommendations:${userId}:50`);
    console.log(`Invalidated recommendation cache for user ${userId}`);
  }
}

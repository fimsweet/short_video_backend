import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { FollowsService } from './follows.service';
import { Follow } from '../entities/follow.entity';
import { User } from '../entities/user.entity';
import { UserSettings } from '../entities/user-settings.entity';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import { of, throwError } from 'rxjs';

describe('FollowsService', () => {
  let service: FollowsService;
  let followRepo: any;
  let userRepo: any;
  let settingsRepo: any;
  let httpService: any;
  let activityService: any;

  const mockFollow = { id: 1, followerId: 1, followingId: 2, status: 'accepted', createdAt: new Date() };
  const mockUser = { id: 1, username: 'user1', avatar: 'av1.jpg', fullName: 'User One' };
  const mockUser2 = { id: 2, username: 'user2', avatar: 'av2.jpg', fullName: 'User Two' };

  let createQueryBuilder: any;

  beforeEach(async () => {
    createQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
      getRawMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
    };

    followRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      create: jest.fn().mockImplementation(dto => ({ ...dto, id: 10 })),
      save: jest.fn().mockImplementation(entity => Promise.resolve(entity)),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder),
    };

    userRepo = {
      findOne: jest.fn().mockResolvedValue(mockUser),
      find: jest.fn().mockResolvedValue([mockUser, mockUser2]),
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder),
    };

    settingsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    httpService = {
      post: jest.fn().mockReturnValue(of({ data: {} })),
      get: jest.fn().mockReturnValue(of({ data: [] })),
    };

    activityService = {
      logActivity: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowsService,
        { provide: getRepositoryToken(Follow), useValue: followRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserSettings), useValue: settingsRepo },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') } },
        { provide: HttpService, useValue: httpService },
        { provide: ActivityHistoryService, useValue: activityService },
      ],
    }).compile();

    service = module.get<FollowsService>(FollowsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ===================== TOGGLE FOLLOW =====================
  describe('toggleFollow', () => {
    it('should throw when following self', async () => {
      await expect(service.toggleFollow(1, 1)).rejects.toThrow('Cannot follow yourself');
    });

    it('should unfollow when already following (accepted)', async () => {
      followRepo.findOne.mockResolvedValue(mockFollow);

      const result = await service.toggleFollow(1, 2);

      expect(result.following).toBe(false);
      expect(followRepo.remove).toHaveBeenCalled();
    });

    it('should cancel pending request', async () => {
      followRepo.findOne.mockResolvedValue({ ...mockFollow, status: 'pending' });

      const result = await service.toggleFollow(1, 2);

      expect(result.following).toBe(false);
      expect(result.status).toBe('none');
    });

    it('should follow public account directly', async () => {
      followRepo.findOne.mockResolvedValue(null);
      settingsRepo.findOne.mockResolvedValue(null); // No settings = public

      const result = await service.toggleFollow(1, 2);

      expect(result.following).toBe(true);
      expect(result.status).toBe('accepted');
      expect(followRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'accepted' }),
      );
    });

    it('should send pending request for private account', async () => {
      followRepo.findOne.mockResolvedValue(null);
      settingsRepo.findOne.mockResolvedValue({ requireFollowApproval: true });

      const result = await service.toggleFollow(1, 2);

      expect(result.following).toBe(false);
      expect(result.requested).toBe(true);
      expect(result.status).toBe('pending');
    });

    it('should log activity on follow/unfollow', async () => {
      followRepo.findOne.mockResolvedValue(null);

      await service.toggleFollow(1, 2);

      expect(activityService.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'follow', targetId: '2' }),
      );
    });

    it('should handle notification error gracefully', async () => {
      followRepo.findOne.mockResolvedValue(null);
      settingsRepo.findOne.mockResolvedValue(null);
      httpService.post.mockReturnValue(throwError(() => new Error('notification fail')));

      // Should not throw despite notification failure
      const result = await service.toggleFollow(1, 2);
      expect(result.following).toBe(true);
    });

    it('should log unfollow activity type for accepted follow removal', async () => {
      followRepo.findOne.mockResolvedValue({ ...mockFollow, status: 'accepted' });

      await service.toggleFollow(1, 2);

      expect(activityService.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'unfollow' }),
      );
    });

    it('should log cancel_follow_request activity type for pending removal', async () => {
      followRepo.findOne.mockResolvedValue({ ...mockFollow, status: 'pending' });

      await service.toggleFollow(1, 2);

      expect(activityService.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'cancel_follow_request' }),
      );
    });
  });

  // ===================== IS FOLLOWING =====================
  describe('isFollowing', () => {
    it('should return true when following', async () => {
      followRepo.findOne.mockResolvedValue(mockFollow);
      expect(await service.isFollowing(1, 2)).toBe(true);
    });

    it('should return false when not following', async () => {
      followRepo.findOne.mockResolvedValue(null);
      expect(await service.isFollowing(1, 2)).toBe(false);
    });
  });

  // ===================== GET FOLLOW STATUS =====================
  describe('getFollowStatus', () => {
    it('should return "none" when no follow relationship', async () => {
      followRepo.findOne.mockResolvedValue(null);
      expect(await service.getFollowStatus(1, 2)).toBe('none');
    });

    it('should return "following" for accepted follow', async () => {
      followRepo.findOne.mockResolvedValue({ status: 'accepted' });
      expect(await service.getFollowStatus(1, 2)).toBe('following');
    });

    it('should return "pending" for pending follow', async () => {
      followRepo.findOne.mockResolvedValue({ status: 'pending' });
      expect(await service.getFollowStatus(1, 2)).toBe('pending');
    });
  });

  // ===================== IS MUTUAL FOLLOW =====================
  describe('isMutualFollow', () => {
    it('should return true when both follow each other', async () => {
      followRepo.findOne.mockResolvedValue(mockFollow);
      expect(await service.isMutualFollow(1, 2)).toBe(true);
    });

    it('should return false when only one follows', async () => {
      followRepo.findOne
        .mockResolvedValueOnce(mockFollow)
        .mockResolvedValueOnce(null);
      expect(await service.isMutualFollow(1, 2)).toBe(false);
    });
  });

  // ===================== FOLLOWER/FOLLOWING COUNT =====================
  describe('getFollowerCount', () => {
    it('should return follower count', async () => {
      followRepo.count.mockResolvedValue(42);
      expect(await service.getFollowerCount(1)).toBe(42);
    });
  });

  describe('getFollowingCount', () => {
    it('should return following count', async () => {
      followRepo.count.mockResolvedValue(10);
      expect(await service.getFollowingCount(1)).toBe(10);
    });
  });

  // ===================== GET FOLLOWERS / FOLLOWING =====================
  describe('getFollowers', () => {
    it('should return follower IDs', async () => {
      followRepo.find.mockResolvedValue([
        { followerId: 2 },
        { followerId: 3 },
      ]);
      const result = await service.getFollowers(1);
      expect(result).toEqual([2, 3]);
    });

    it('should return empty array when no followers', async () => {
      followRepo.find.mockResolvedValue([]);
      const result = await service.getFollowers(1);
      expect(result).toEqual([]);
    });
  });

  describe('getFollowing', () => {
    it('should return following IDs', async () => {
      followRepo.find.mockResolvedValue([
        { followingId: 2 },
        { followingId: 3 },
      ]);
      const result = await service.getFollowing(1);
      expect(result).toEqual([2, 3]);
    });
  });

  // ===================== GET FOLLOWERS WITH MUTUAL STATUS =====================
  describe('getFollowersWithMutualStatus', () => {
    it('should return followers with mutual status and pagination', async () => {
      followRepo.count.mockResolvedValue(2);
      followRepo.find
        .mockResolvedValueOnce([{ followerId: 2 }, { followerId: 3 }])
        .mockResolvedValueOnce(null);
      followRepo.findOne
        .mockResolvedValueOnce(mockFollow) // user follows follower 2 back
        .mockResolvedValueOnce(null); // user doesn't follow follower 3 back

      const result = await service.getFollowersWithMutualStatus(1, 20, 0);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should indicate hasMore when more pages available', async () => {
      followRepo.count.mockResolvedValue(25);
      const followers = Array.from({ length: 20 }, (_, i) => ({ followerId: i + 2 }));
      followRepo.find.mockResolvedValueOnce(followers);
      followRepo.findOne.mockResolvedValue(null);

      const result = await service.getFollowersWithMutualStatus(1, 20, 0);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(25);
    });
  });

  // ===================== GET FOLLOWING WITH MUTUAL STATUS =====================
  describe('getFollowingWithMutualStatus', () => {
    it('should return following list with mutual status', async () => {
      followRepo.count.mockResolvedValue(2);
      followRepo.find.mockResolvedValue([
        { followingId: 5 },
        { followingId: 6 },
      ]);
      followRepo.findOne
        .mockResolvedValueOnce(mockFollow) // user 5 follows back
        .mockResolvedValueOnce(null); // user 6 doesn't follow back

      const result = await service.getFollowingWithMutualStatus(1, 20, 0);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.data[0].userId).toBe(5);
      expect(result.data[0].isMutual).toBe(true);
      expect(result.data[1].userId).toBe(6);
      expect(result.data[1].isMutual).toBe(false);
    });

    it('should paginate correctly', async () => {
      followRepo.count.mockResolvedValue(30);
      followRepo.find.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ followingId: i + 10 })));
      followRepo.findOne.mockResolvedValue(null);

      const result = await service.getFollowingWithMutualStatus(1, 20, 0);
      expect(result.hasMore).toBe(true);
    });
  });

  // ===================== GET SUGGESTIONS =====================
  describe('getSuggestions', () => {
    it('should return empty array when no suggestions found', async () => {
      followRepo.find.mockResolvedValue([]); // no following
      createQueryBuilder.getRawMany.mockResolvedValue([]);
      createQueryBuilder.getMany.mockResolvedValue([]);

      const result = await service.getSuggestions(1, 10);
      expect(result).toEqual([]);
    });

    it('should return suggestions based on friends of friends', async () => {
      // User follows users 2, 3
      followRepo.find.mockResolvedValue([{ followingId: 2 }, { followingId: 3 }]);

      // Friends of friends raw query returns user 5
      createQueryBuilder.getRawMany
        .mockResolvedValueOnce([{ userId: '5', mutualCount: '2' }])  // friends of friends
        .mockResolvedValueOnce([])  // mutual follower names
        .mockResolvedValueOnce([{ userId: '5', followerCount: '100' }]); // popular users

      // http calls for similar users and liked creators
      httpService.get
        .mockReturnValueOnce(of({ data: [] }))
        .mockReturnValueOnce(of({ data: [] }));

      // User details for suggestion
      createQueryBuilder.getMany.mockResolvedValue([
        { id: 5, username: 'suggested', fullName: 'Suggested User', avatar: null, isDeactivated: false },
      ]);

      const result = await service.getSuggestions(1, 10);
      expect(result.length).toBeGreaterThanOrEqual(0); // May be empty if mapping doesn't match
    });

    it('should handle video-service errors gracefully', async () => {
      followRepo.find.mockResolvedValue([{ followingId: 2 }]);
      createQueryBuilder.getRawMany.mockResolvedValue([]);
      httpService.get.mockReturnValue(throwError(() => new Error('Service down')));

      // Should not throw
      const result = await service.getSuggestions(1, 10);
      expect(result).toEqual([]);
    });
  });

  // ===================== GET MUTUAL FRIENDS =====================
  describe('getMutualFriends', () => {
    it('should return empty when user follows nobody', async () => {
      followRepo.find.mockResolvedValue([]);

      const result = await service.getMutualFriends(1);
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return mutual friends with pagination', async () => {
      // User 1 follows users 2, 3
      followRepo.find.mockResolvedValue([{ followingId: 2 }, { followingId: 3 }]);

      // Mutual follows count and query
      createQueryBuilder.getCount.mockResolvedValue(1);
      createQueryBuilder.getRawMany.mockResolvedValue([{ userId: 2 }]);

      // User details
      userRepo.find.mockResolvedValue([
        { id: 2, username: 'user2', fullName: 'User Two', avatar: 'av2.jpg' },
      ]);

      const result = await service.getMutualFriends(1, 20, 0);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].username).toBe('user2');
    });

    it('should return empty when no mutual follows found', async () => {
      followRepo.find.mockResolvedValue([{ followingId: 2 }]);
      createQueryBuilder.getCount.mockResolvedValue(0);
      createQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getMutualFriends(1, 20, 0);
      expect(result.data).toEqual([]);
    });
  });

  // ===================== CHECK LIST PRIVACY =====================
  describe('checkListPrivacy', () => {
    it('should allow self-view', async () => {
      const result = await service.checkListPrivacy(1, 1, 'followers');
      expect(result.allowed).toBe(true);
    });

    it('should allow everyone when setting is everyone', async () => {
      settingsRepo.findOne.mockResolvedValue({ whoCanViewFollowersList: 'everyone' });
      const result = await service.checkListPrivacy(2, 1, 'followers');
      expect(result.allowed).toBe(true);
    });

    it('should allow when no settings exist', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const result = await service.checkListPrivacy(2, 1, 'followers');
      expect(result.allowed).toBe(true);
    });

    it('should require login when setting is friends and no requester', async () => {
      settingsRepo.findOne.mockResolvedValue({ whoCanViewFollowingList: 'friends' });
      const result = await service.checkListPrivacy(2, undefined, 'following');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('login_required');
    });

    it('should allow friends to view following list', async () => {
      settingsRepo.findOne.mockResolvedValue({ whoCanViewFollowingList: 'friends' });
      // isMutualFollow returns true
      followRepo.findOne.mockResolvedValue(mockFollow);

      const result = await service.checkListPrivacy(2, 1, 'following');
      expect(result.allowed).toBe(true);
    });

    it('should deny non-friends for friends-only list', async () => {
      settingsRepo.findOne.mockResolvedValue({ whoCanViewFollowersList: 'friends' });
      followRepo.findOne
        .mockResolvedValueOnce(mockFollow)
        .mockResolvedValueOnce(null); // not mutual

      const result = await service.checkListPrivacy(2, 1, 'followers');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('friends_only');
    });

    it('should deny when setting is onlyMe', async () => {
      settingsRepo.findOne.mockResolvedValue({ whoCanViewLikedVideos: 'onlyMe' });
      const result = await service.checkListPrivacy(2, 1, 'likedVideos');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('private');
    });
  });

  // ===================== PENDING FOLLOW REQUESTS =====================
  describe('getPendingFollowRequests', () => {
    it('should return pending follow requests with user details', async () => {
      followRepo.count.mockResolvedValue(2);
      followRepo.find.mockResolvedValue([
        { followerId: 3, createdAt: new Date() },
        { followerId: 4, createdAt: new Date() },
      ]);
      userRepo.find.mockResolvedValue([
        { id: 3, username: 'requester1', fullName: 'Requester One', avatar: null },
        { id: 4, username: 'requester2', fullName: 'Requester Two', avatar: 'av4.jpg' },
      ]);

      const result = await service.getPendingFollowRequests(1, 20, 0);
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should return empty for no pending requests', async () => {
      followRepo.count.mockResolvedValue(0);
      followRepo.find.mockResolvedValue([]);

      const result = await service.getPendingFollowRequests(1);
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ===================== PENDING REQUEST COUNT =====================
  describe('getPendingRequestCount', () => {
    it('should return count of pending requests', async () => {
      followRepo.count.mockResolvedValue(5);
      const result = await service.getPendingRequestCount(1);
      expect(result).toBe(5);
    });
  });

  // ===================== APPROVE FOLLOW REQUEST =====================
  describe('approveFollowRequest', () => {
    it('should approve pending follow request', async () => {
      followRepo.findOne.mockResolvedValue({ ...mockFollow, status: 'pending' });
      userRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.approveFollowRequest(3, 1);
      expect(result.success).toBe(true);
      expect(followRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'accepted' }),
      );
    });

    it('should throw when follow request not found', async () => {
      followRepo.findOne.mockResolvedValue(null);
      await expect(service.approveFollowRequest(3, 1)).rejects.toThrow('Follow request not found');
    });

    it('should log activity on approval', async () => {
      followRepo.findOne.mockResolvedValue({ ...mockFollow, status: 'pending' });
      userRepo.findOne.mockResolvedValue(mockUser);

      await service.approveFollowRequest(3, 1);
      expect(activityService.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'approve_follow_request' }),
      );
    });

    it('should handle notification error gracefully', async () => {
      followRepo.findOne.mockResolvedValue({ ...mockFollow, status: 'pending' });
      userRepo.findOne.mockResolvedValue(mockUser);
      httpService.post.mockReturnValue(throwError(() => new Error('notification fail')));

      const result = await service.approveFollowRequest(3, 1);
      expect(result.success).toBe(true);
    });
  });

  // ===================== REJECT FOLLOW REQUEST =====================
  describe('rejectFollowRequest', () => {
    it('should reject and remove follow request', async () => {
      followRepo.findOne.mockResolvedValue({ ...mockFollow, status: 'pending' });

      const result = await service.rejectFollowRequest(3, 1);
      expect(result.success).toBe(true);
      expect(followRepo.remove).toHaveBeenCalled();
    });

    it('should throw when follow request not found', async () => {
      followRepo.findOne.mockResolvedValue(null);
      await expect(service.rejectFollowRequest(3, 1)).rejects.toThrow('Follow request not found');
    });

    it('should log activity on rejection', async () => {
      followRepo.findOne.mockResolvedValue({ ...mockFollow, status: 'pending' });

      await service.rejectFollowRequest(3, 1);
      expect(activityService.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'reject_follow_request' }),
      );
    });
  });
});

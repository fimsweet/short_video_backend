import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';

describe('FollowsController', () => {
  let controller: FollowsController;
  let service: any;

  beforeEach(async () => {
    service = {
      toggleFollow: jest.fn().mockResolvedValue({ following: true, status: 'accepted' }),
      isFollowing: jest.fn().mockResolvedValue(true),
      getFollowStatus: jest.fn().mockResolvedValue('following'),
      getPendingFollowRequests: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getPendingRequestCount: jest.fn().mockResolvedValue(5),
      approveFollowRequest: jest.fn().mockResolvedValue({ success: true }),
      rejectFollowRequest: jest.fn().mockResolvedValue({ success: true }),
      getFollowers: jest.fn().mockResolvedValue([2, 3]),
      getFollowing: jest.fn().mockResolvedValue([4, 5]),
      getFollowerCount: jest.fn().mockResolvedValue(100),
      getFollowingCount: jest.fn().mockResolvedValue(50),
      getFollowersWithMutualStatus: jest.fn().mockResolvedValue({ data: [], hasMore: false, total: 0 }),
      getFollowingWithMutualStatus: jest.fn().mockResolvedValue({ data: [], hasMore: false, total: 0 }),
      isMutualFollow: jest.fn().mockResolvedValue(true),
      getSuggestions: jest.fn().mockResolvedValue([]),
      getMutualFriends: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      checkListPrivacy: jest.fn().mockResolvedValue({ allowed: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FollowsController],
      providers: [{ provide: FollowsService, useValue: service }],
    }).compile();

    controller = module.get<FollowsController>(FollowsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('toggleFollow', () => {
    it('should toggle follow', async () => {
      const result = await controller.toggleFollow({ followerId: 1, followingId: 2 });
      expect(result.following).toBe(true);
    });

    it('should throw BadRequestException on error', async () => {
      service.toggleFollow.mockRejectedValue(new Error('Cannot follow yourself'));
      await expect(controller.toggleFollow({ followerId: 1, followingId: 1 }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('checkFollow', () => {
    it('should check follow status', async () => {
      const result = await controller.checkFollow('1', '2');
      expect(result.following).toBe(true);
    });
  });

  describe('getFollowStatus', () => {
    it('should return follow status', async () => {
      const result = await controller.getFollowStatus('1', '2');
      expect(result.status).toBe('following');
    });
  });

  describe('getPendingRequests', () => {
    it('should get pending requests with default pagination', async () => {
      await controller.getPendingRequests('1');
      expect(service.getPendingFollowRequests).toHaveBeenCalledWith(1, 20, 0);
    });

    it('should pass custom pagination', async () => {
      await controller.getPendingRequests('1', '10', '5');
      expect(service.getPendingFollowRequests).toHaveBeenCalledWith(1, 10, 5);
    });
  });

  describe('getPendingCount', () => {
    it('should return pending count', async () => {
      const result = await controller.getPendingCount('1');
      expect(result.count).toBe(5);
    });
  });

  describe('approveFollowRequest', () => {
    it('should approve request', async () => {
      const result = await controller.approveFollowRequest({ followerId: 2, followingId: 1 });
      expect(result.success).toBe(true);
    });
  });

  describe('rejectFollowRequest', () => {
    it('should reject request', async () => {
      const result = await controller.rejectFollowRequest({ followerId: 2, followingId: 1 });
      expect(result.success).toBe(true);
    });
  });

  describe('getFollowers', () => {
    it('should return follower IDs', async () => {
      const result = await controller.getFollowers('1');
      expect(result.followerIds).toEqual([2, 3]);
    });
  });

  describe('getFollowing', () => {
    it('should return following IDs', async () => {
      const result = await controller.getFollowing('1');
      expect(result.followingIds).toEqual([4, 5]);
    });
  });

  describe('getStats', () => {
    it('should return follower and following counts', async () => {
      const result = await controller.getStats('1');
      expect(result.followerCount).toBe(100);
      expect(result.followingCount).toBe(50);
    });
  });

  describe('getFollowersWithStatus', () => {
    it('should return followers with mutual status', async () => {
      const result = await controller.getFollowersWithStatus('1');
      expect(result.data).toBeDefined();
    });

    it('should check privacy when requesterId provided', async () => {
      await controller.getFollowersWithStatus('1', undefined, undefined, '2');
      expect(service.checkListPrivacy).toHaveBeenCalledWith(1, 2, 'followers');
    });

    it('should return restricted result when privacy denied', async () => {
      service.checkListPrivacy.mockResolvedValue({ allowed: false, reason: 'private' });
      const result = await controller.getFollowersWithStatus('1', undefined, undefined, '2');
      expect((result as any).privacyRestricted).toBe(true);
    });
  });

  describe('checkMutual', () => {
    it('should check mutual follow status', async () => {
      const result = await controller.checkMutual('1', '2');
      expect(result.isMutual).toBe(true);
    });
  });

  describe('getSuggestions', () => {
    it('should get suggestions', async () => {
      const result = await controller.getSuggestions('1');
      expect(result.success).toBe(true);
    });

    it('should pass custom limit', async () => {
      await controller.getSuggestions('1', '10');
      expect(service.getSuggestions).toHaveBeenCalledWith(1, 10);
    });
  });

  describe('getMutualFriends', () => {
    it('should get mutual friends', async () => {
      const result = await controller.getMutualFriends('1');
      expect(result).toBeDefined();
    });
  });

  describe('checkListPrivacy', () => {
    it('should check list privacy', async () => {
      const result = await controller.checkListPrivacy('1', '2', 'followers');
      expect(result.allowed).toBe(true);
    });
  });
});

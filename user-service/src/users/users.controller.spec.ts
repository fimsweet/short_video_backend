import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: any;

  const mockReq = { user: { userId: 1, username: 'testuser' } };
  const mockUser = {
    id: 1,
    username: 'testuser',
    email: 'test@test.com',
    fullName: 'Test User',
    isDeactivated: false,
  };

  beforeEach(async () => {
    service = {
      findOne: jest.fn().mockResolvedValue(mockUser),
      findById: jest.fn().mockResolvedValue(mockUser),
      isUsernameAvailable: jest.fn().mockResolvedValue(true),
      searchUsers: jest.fn().mockResolvedValue([mockUser]),
      updateAvatar: jest.fn().mockResolvedValue({ ...mockUser, avatar: '/new.jpg', password: 'hash' }),
      removeAvatar: jest.fn().mockResolvedValue({ ...mockUser, avatar: null, password: 'hash' }),
      updateProfile: jest.fn().mockResolvedValue(mockUser),
      changeDisplayName: jest.fn().mockResolvedValue({ success: true }),
      removeDisplayName: jest.fn().mockResolvedValue({ success: true }),
      getDisplayNameChangeInfo: jest.fn().mockResolvedValue({ canChange: true }),
      changeUsername: jest.fn().mockResolvedValue({ success: true }),
      getUsernameChangeInfo: jest.fn().mockResolvedValue({ canChange: true }),
      changePassword: jest.fn().mockResolvedValue({ success: true }),
      setPassword: jest.fn().mockResolvedValue({ success: true }),
      hasPassword: jest.fn().mockResolvedValue(true),
      generatePasswordResetOtp: jest.fn().mockResolvedValue({ success: true }),
      verifyOtp: jest.fn().mockResolvedValue({ success: true }),
      verifyOtpAndResetPassword: jest.fn().mockResolvedValue({ success: true }),
      blockUser: jest.fn().mockResolvedValue(undefined),
      unblockUser: jest.fn().mockResolvedValue(undefined),
      getBlockedUsers: jest.fn().mockResolvedValue([]),
      isUserBlocked: jest.fn().mockResolvedValue(false),
      getUserSettings: jest.fn().mockResolvedValue({ theme: 'dark' }),
      updateUserSettings: jest.fn().mockResolvedValue({ theme: 'light' }),
      updateLastSeen: jest.fn().mockResolvedValue(undefined),
      getOnlineStatus: jest.fn().mockResolvedValue({ isOnline: true }),
      deactivateAccount: jest.fn().mockResolvedValue({ success: true }),
      reactivateAccount: jest.fn().mockResolvedValue({ success: true }),
      checkDeactivatedStatus: jest.fn().mockResolvedValue({ isDeactivated: false }),
      getDeactivatedUserIds: jest.fn().mockResolvedValue([]),
      getPrivacySettings: jest.fn().mockResolvedValue({ privateAccount: false }),
      checkPrivacyPermission: jest.fn().mockResolvedValue({ allowed: true }),
      getPrivacySettingsBatch: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getUserSettings', () => {
    it('should return user settings', async () => {
      const result = await controller.getUserSettings(mockReq);
      expect(result.success).toBe(true);
      expect(result.settings).toBeDefined();
    });
  });

  describe('updateUserSettings', () => {
    it('should update settings', async () => {
      const result = await controller.updateUserSettings(mockReq, { theme: 'light' } as any);
      expect(result.success).toBe(true);
    });
  });

  describe('checkUsernameAvailability', () => {
    it('should check username', async () => {
      const result = await controller.checkUsernameAvailability('newuser');
      expect(result.available).toBe(true);
    });
  });

  describe('searchUsers', () => {
    it('should search users', async () => {
      const result = await controller.searchUsers('test');
      expect(result.users).toBeDefined();
    });
  });

  describe('findById', () => {
    it('should find user by ID', async () => {
      const result = await controller.findById('1');
      expect(result.username).toBe('testuser');
    });

    it('should throw NotFoundException for non-existent user', async () => {
      service.findById.mockResolvedValue(null);
      await expect(controller.findById('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('should find user by username', () => {
      controller.findOne('testuser');
      expect(service.findOne).toHaveBeenCalledWith('testuser');
    });
  });

  describe('uploadAvatar', () => {
    it('should upload avatar', async () => {
      const file = { filename: 'test.jpg' } as Express.Multer.File;
      const result = await controller.uploadAvatar(mockReq, file);
      expect(result.message).toContain('Avatar uploaded');
    });

    it('should throw on missing file', async () => {
      await expect(controller.uploadAvatar(mockReq, null as any))
        .rejects.toThrow('No file uploaded');
    });
  });

  describe('removeAvatar', () => {
    it('should remove avatar', async () => {
      const result = await controller.removeAvatar(mockReq);
      expect(result.message).toContain('Avatar removed');
    });
  });

  describe('updateProfile', () => {
    it('should update profile', async () => {
      const result = await controller.updateProfile(mockReq, { bio: 'New bio' });
      expect(result.success).toBe(true);
    });
  });

  describe('changeUsername', () => {
    it('should change username', async () => {
      const result = await controller.changeUsername(mockReq, { newUsername: 'newname' });
      expect(result.success).toBe(true);
    });
  });

  describe('changePassword', () => {
    it('should change password', async () => {
      const result = await controller.changePassword(mockReq, {
        currentPassword: 'old', newPassword: 'new123',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('hasPassword', () => {
    it('should check if user has password', async () => {
      const result = await controller.hasPassword(mockReq);
      expect(result.hasPassword).toBe(true);
    });
  });

  describe('forgotPassword', () => {
    it('should send password reset OTP', async () => {
      const result = await controller.forgotPassword({ email: 'test@test.com' });
      expect(result.success).toBe(true);
    });
  });

  describe('verifyOtp', () => {
    it('should verify OTP', async () => {
      const result = await controller.verifyOtp({ email: 'test@test.com', otp: '123456' });
      expect(result.success).toBe(true);
    });
  });

  describe('resetPassword', () => {
    it('should reset password with OTP', async () => {
      const result = await controller.resetPassword({
        email: 'test@test.com', otp: '123456', newPassword: 'newpass',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('blockUser', () => {
    it('should block user', async () => {
      const result = await controller.blockUser({ userId: '1' }, '2');
      expect(result.success).toBe(true);
    });
  });

  describe('unblockUser', () => {
    it('should unblock user', async () => {
      const result = await controller.unblockUser({ userId: '1' }, '2');
      expect(result.success).toBe(true);
    });
  });

  describe('getBlockedUsers', () => {
    it('should get blocked users', async () => {
      await controller.getBlockedUsers('1');
      expect(service.getBlockedUsers).toHaveBeenCalledWith(1);
    });
  });

  describe('isUserBlocked', () => {
    it('should check block status', async () => {
      const result = await controller.isUserBlocked('1', '2');
      expect(result.isBlocked).toBe(false);
    });
  });

  describe('updateHeartbeat', () => {
    it('should update heartbeat', async () => {
      const result = await controller.updateHeartbeat('1');
      expect(result.success).toBe(true);
    });
  });

  describe('getOnlineStatus', () => {
    it('should get online status', async () => {
      const result = await controller.getOnlineStatus('1');
      expect(result.success).toBe(true);
    });
  });

  describe('deactivateAccount', () => {
    it('should deactivate account', async () => {
      const result = await controller.deactivateAccount(mockReq, { password: 'pass' });
      expect(result.success).toBe(true);
    });
  });

  describe('reactivateAccount', () => {
    it('should reactivate account', async () => {
      const result = await controller.reactivateAccount({ username: 'test', password: 'pass' });
      expect(result.success).toBe(true);
    });
  });

  describe('getPrivacySettings', () => {
    it('should get privacy settings', async () => {
      const result = await controller.getPrivacySettings('1');
      expect(result.success).toBe(true);
    });
  });

  describe('checkPrivacyPermission', () => {
    it('should check privacy permission', async () => {
      const result = await controller.checkPrivacyPermission({
        requesterId: '1', targetUserId: '2', action: 'view_video',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('getPrivacySettingsBatch', () => {
    it('should return batch privacy settings', async () => {
      const result = await controller.getPrivacySettingsBatch({ userIds: [1, 2] });
      expect(result.success).toBe(true);
    });
  });

  describe('getDeactivatedBatch', () => {
    it('should return deactivated user IDs', async () => {
      const result = await controller.getDeactivatedBatch({ userIds: [1, 2, 3] });
      expect(result.deactivatedIds).toEqual([]);
    });
  });
});

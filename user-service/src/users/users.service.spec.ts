import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';
import { BlockedUser } from '../entities/blocked-user.entity';
import { UserSettings } from '../entities/user-settings.entity';
import { Follow } from '../entities/follow.entity';
import { EmailService } from '../config/email.service';
import { SessionsService } from '../sessions/sessions.service';
import * as bcrypt from 'bcrypt';

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: any;
  let blockedUserRepo: any;
  let settingsRepo: any;
  let followRepo: any;
  let cacheManager: any;
  let emailService: any;
  let sessionsService: any;
  let configService: any;

  const mockUser: any = {
    id: 1,
    username: 'testuser',
    email: 'test@test.com',
    password: '$2b$10$hashedpassword',
    fullName: 'Test User',
    avatar: null,
    bio: null,
    phoneNumber: null,
    authProvider: 'email',
    providerId: null,
    isDeactivated: false,
    deactivatedAt: null,
    twoFactorEnabled: false,
    twoFactorMethods: null,
    totpSecret: null,
    lastSeen: new Date(),
    createdAt: new Date(),
    usernameLastChangedAt: null,
    displayNameLastChangedAt: null,
    gender: null,
    dateOfBirth: null,
    isVerified: true,
  };

  const mockSettings: any = {
    id: 1,
    userId: 1,
    language: 'vi',
    theme: 'dark',
    notificationsEnabled: true,
    pushNotifications: true,
    emailNotifications: true,
    pushLikes: true,
    pushComments: true,
    pushNewFollowers: true,
    pushMessages: true,
    accountPrivacy: 'public',
    showOnlineStatus: true,
    whoCanViewVideos: 'everyone',
    whoCanSendMessages: 'everyone',
    whoCanComment: 'everyone',
    filterComments: true,
    requireFollowApproval: false,
    whoCanViewFollowingList: 'everyone',
    whoCanViewFollowersList: 'everyone',
    whoCanViewLikedVideos: 'everyone',
  };

  let createQueryBuilder: any;

  beforeEach(async () => {
    createQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
      getRawMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
    };

    userRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(dto => ({ ...dto, id: 1 })),
      save: jest.fn().mockImplementation(entity => Promise.resolve({ ...mockUser, ...entity })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder),
    };

    blockedUserRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    settingsRepo = {
      findOne: jest.fn().mockResolvedValue(mockSettings),
      find: jest.fn().mockResolvedValue([mockSettings]),
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn().mockImplementation(entity => Promise.resolve({ ...mockSettings, ...entity })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    followRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    emailService = {
      sendOtpEmail: jest.fn().mockResolvedValue(true),
      send2FAOtpEmail: jest.fn().mockResolvedValue(true),
    };

    sessionsService = {
      logoutAllSessions: jest.fn().mockResolvedValue({ loggedOut: 3 }),
    };

    configService = { get: jest.fn().mockReturnValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(BlockedUser), useValue: blockedUserRepo },
        { provide: getRepositoryToken(UserSettings), useValue: settingsRepo },
        { provide: getRepositoryToken(Follow), useValue: followRepo },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: EmailService, useValue: emailService },
        { provide: ConfigService, useValue: configService },
        { provide: SessionsService, useValue: sessionsService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ===================== CREATE =====================
  describe('create', () => {
    it('should create a new user with hashed password', async () => {
      userRepo.findOne.mockResolvedValue(null);
      
      const result = await service.create({
        username: 'newuser',
        password: 'password123',
        email: 'new@test.com',
      } as any);

      expect(result.username).toBeDefined();
      expect((result as any).password).toBeUndefined();
      expect(userRepo.save).toHaveBeenCalled();
      expect(settingsRepo.save).toHaveBeenCalled();
    });

    it('should throw ConflictException on duplicate username', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, username: 'newuser' });
      
      await expect(service.create({
        username: 'newuser',
        password: 'pass',
        email: 'unique@test.com',
      } as any)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException on duplicate email', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, email: 'dup@test.com', username: 'other' });
      
      await expect(service.create({
        username: 'newuser',
        password: 'pass',
        email: 'dup@test.com',
      } as any)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException on duplicate phone number', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)   // username/email check
        .mockResolvedValueOnce({ id: 99, phoneNumber: '+84123' }); // phone check
      
      await expect(service.create({
        username: 'newuser',
        password: 'pass',
        email: 'new@test.com',
        phoneNumber: '+84123',
      } as any)).rejects.toThrow(ConflictException);
    });

    it('should create user settings with provided language', async () => {
      userRepo.findOne.mockResolvedValue(null);
      
      await service.create({
        username: 'newuser',
        password: 'pass',
        email: 'new@test.com',
        language: 'en',
      } as any);

      expect(settingsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'en' }),
      );
    });
  });

  // ===================== USERNAME AVAILABLE =====================
  describe('isUsernameAvailable', () => {
    it('should return true when username not taken', async () => {
      userRepo.findOne.mockResolvedValue(null);
      expect(await service.isUsernameAvailable('newuser')).toBe(true);
    });

    it('should return false when username taken', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      expect(await service.isUsernameAvailable('testuser')).toBe(false);
    });
  });

  // ===================== FIND ONE =====================
  describe('findOne', () => {
    it('should return cached user on cache hit', async () => {
      cacheManager.get.mockResolvedValue(mockUser);
      const result = await service.findOne('testuser');
      expect(result).toEqual(mockUser);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('should find user from DB on cache miss and cache result', async () => {
      cacheManager.get.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.findOne('testuser');
      expect(result).toEqual(mockUser);
      expect(cacheManager.set).toHaveBeenCalledWith(`user:username:testuser`, mockUser, 600000);
    });

    it('should return null for non-existent username', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.findOne('nobody');
      expect(result).toBeNull();
      expect(cacheManager.set).not.toHaveBeenCalled();
    });
  });

  // ===================== FIND BY ID =====================
  describe('findById', () => {
    it('should return cached user on cache hit', async () => {
      cacheManager.get.mockResolvedValue(mockUser);
      const result = await service.findById(1);
      expect(result).toEqual(mockUser);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('should find user from DB and cache by id and username', async () => {
      cacheManager.get.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.findById(1);
      expect(result).toEqual(mockUser);
      expect(cacheManager.set).toHaveBeenCalledTimes(2);
    });

    it('should return null when user not found', async () => {
      cacheManager.get.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.findById(999);
      expect(result).toBeNull();
    });
  });

  // ===================== FIND BY EMAIL =====================
  describe('findByEmail', () => {
    it('should find user by email', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.findByEmail('test@test.com');
      expect(result).toEqual(mockUser);
    });
  });

  // ===================== FIND BY PROVIDER ID =====================
  describe('findByProviderId', () => {
    it('should find user by provider and providerId', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, authProvider: 'google', providerId: 'g123' });
      const result = await service.findByProviderId('google' as any, 'g123');
      expect(result).toBeDefined();
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { authProvider: 'google', providerId: 'g123' },
      });
    });
  });

  // ===================== CREATE OAUTH USER =====================
  describe('createOAuthUser', () => {
    it('should create OAuth user with settings', async () => {
      const result = await service.createOAuthUser({
        username: 'oauthuser',
        email: 'oauth@test.com',
        authProvider: 'google' as any,
        providerId: 'g12345',
        fullName: 'OAuth User',
      });

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ password: null, isVerified: true }),
      );
      expect(userRepo.save).toHaveBeenCalled();
      expect(settingsRepo.save).toHaveBeenCalled();
      expect(result).not.toHaveProperty('password');
    });
  });

  // ===================== CREATE EMAIL USER =====================
  describe('createEmailUser', () => {
    it('should create email user with isVerified false', async () => {
      const result = await service.createEmailUser({
        username: 'emailuser',
        email: 'emailu@test.com',
        password: 'hashedpass',
      });

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ authProvider: 'email', isVerified: false }),
      );
      expect(userRepo.save).toHaveBeenCalled();
      expect(settingsRepo.save).toHaveBeenCalled();
      expect(result).not.toHaveProperty('password');
    });
  });

  // ===================== FIND BY PHONE =====================
  describe('findByPhone', () => {
    it('should find user by phone', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, phoneNumber: '+84123' });
      const result = await service.findByPhone('+84123');
      expect(result).toBeDefined();
    });

    it('should return null when phone not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.findByPhone('+84999');
      expect(result).toBeNull();
    });
  });

  // ===================== CREATE PHONE USER =====================
  describe('createPhoneUser', () => {
    it('should create phone user successfully', async () => {
      // findByPhone returns null, findOne (username check) also null
      userRepo.findOne.mockResolvedValue(null);
      cacheManager.get.mockResolvedValue(null);

      const result = await service.createPhoneUser({
        username: 'phoneuser',
        phone: '+84123456789',
        firebaseUid: 'fb_uid_123',
      });

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authProvider: 'phone',
          email: null,
          password: null,
          isVerified: true,
        }),
      );
      expect(result).not.toHaveProperty('password');
    });

    it('should throw ConflictException when phone already exists', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, phoneNumber: '+84123456789' });

      await expect(service.createPhoneUser({
        username: 'phoneuser',
        phone: '+84123456789',
        firebaseUid: 'fb_uid',
      })).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when username taken', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null);  // findByPhone
      // findOne (username) called via this.findOne which checks cache first
      cacheManager.get.mockResolvedValue(null);
      userRepo.findOne
        .mockResolvedValueOnce(null)   // findByPhone
        .mockResolvedValueOnce(mockUser); // findOne username check

      // Reset to ensure correct mock chain
      userRepo.findOne.mockReset();
      userRepo.findOne
        .mockResolvedValueOnce(null)    // phone check
        .mockResolvedValueOnce(mockUser); // username check

      await expect(service.createPhoneUser({
        username: 'testuser',
        phone: '+84newphone',
        firebaseUid: 'fb_uid',
      })).rejects.toThrow(ConflictException);
    });
  });

  // ===================== UPDATE/REMOVE AVATAR =====================
  describe('updateAvatar', () => {
    it('should update user avatar and invalidate cache', async () => {
      cacheManager.get.mockResolvedValue(mockUser); // findById returns cached
      const result = await service.updateAvatar(1, '/uploads/avatars/new.jpg');
      expect(userRepo.save).toHaveBeenCalled();
      expect(cacheManager.del).toHaveBeenCalledWith('user:id:1');
      expect(cacheManager.del).toHaveBeenCalledWith('user:username:testuser');
    });

    it('should throw NotFoundException for invalid user', async () => {
      cacheManager.get.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.updateAvatar(999, '/path.jpg')).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeAvatar', () => {
    it('should remove user avatar and set to null', async () => {
      cacheManager.get.mockResolvedValue({ ...mockUser, avatar: '/old.jpg' });
      const result = await service.removeAvatar(1);
      expect(userRepo.save).toHaveBeenCalled();
      expect(cacheManager.del).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user not found', async () => {
      cacheManager.get.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.removeAvatar(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ===================== UPDATE PROFILE =====================
  describe('updateProfile', () => {
    it('should update multiple profile fields', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser });
      const result = await service.updateProfile(1, {
        bio: 'New bio',
        fullName: 'New Name',
        gender: 'male',
        dateOfBirth: '2000-01-01',
        avatar: '/new-avatar.jpg',
      });
      expect(userRepo.save).toHaveBeenCalled();
      expect(cacheManager.del).toHaveBeenCalledWith('user:id:1');
      expect(result).toHaveProperty('bio');
    });

    it('should throw error when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.updateProfile(999, { bio: 'x' })).rejects.toThrow('User not found');
    });

    it('should handle dateOfBirth as null', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser });
      await service.updateProfile(1, { dateOfBirth: '' });
      const savedEntity = userRepo.save.mock.calls[0][0];
      expect(savedEntity.dateOfBirth).toBeNull();
    });
  });

  // ===================== USERNAME CHANGE INFO =====================
  describe('getUsernameChangeInfo', () => {
    it('should return canChange true when never changed', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, usernameLastChangedAt: null });
      const result = await service.getUsernameChangeInfo(1);
      expect(result.canChange).toBe(true);
      expect(result.daysUntilChange).toBe(0);
    });

    it('should return canChange false within 30-day cooldown', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 5); // 5 days ago
      userRepo.findOne.mockResolvedValue({ ...mockUser, usernameLastChangedAt: recentDate });
      const result = await service.getUsernameChangeInfo(1);
      expect(result.canChange).toBe(false);
      expect(result.daysUntilChange).toBeGreaterThan(0);
    });

    it('should return canChange true after 30-day cooldown', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31); // 31 days ago
      userRepo.findOne.mockResolvedValue({ ...mockUser, usernameLastChangedAt: oldDate });
      const result = await service.getUsernameChangeInfo(1);
      expect(result.canChange).toBe(true);
      expect(result.daysUntilChange).toBe(0);
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.getUsernameChangeInfo(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ===================== DISPLAY NAME CHANGE INFO =====================
  describe('getDisplayNameChangeInfo', () => {
    it('should return canChange true when never changed', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, displayNameLastChangedAt: null });
      const result = await service.getDisplayNameChangeInfo(1);
      expect(result.canChange).toBe(true);
    });

    it('should return canChange false within 7-day cooldown', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3);
      userRepo.findOne.mockResolvedValue({ ...mockUser, displayNameLastChangedAt: recentDate });
      const result = await service.getDisplayNameChangeInfo(1);
      expect(result.canChange).toBe(false);
      expect(result.daysUntilChange).toBeGreaterThan(0);
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.getDisplayNameChangeInfo(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ===================== CHANGE DISPLAY NAME =====================
  describe('changeDisplayName', () => {
    it('should change display name successfully', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, fullName: 'Old Name', displayNameLastChangedAt: null });
      const result = await service.changeDisplayName(1, 'New Name');
      expect(result.success).toBe(true);
      expect(result.message).toBe('DISPLAY_NAME_CHANGED');
    });

    it('should reject empty name', async () => {
      const result = await service.changeDisplayName(1, '   ');
      expect(result.success).toBe(false);
      expect(result.message).toBe('DISPLAY_NAME_EMPTY');
    });

    it('should reject too short name', async () => {
      const result = await service.changeDisplayName(1, 'A');
      expect(result.success).toBe(false);
      expect(result.message).toBe('DISPLAY_NAME_TOO_SHORT');
    });

    it('should reject too long name', async () => {
      const result = await service.changeDisplayName(1, 'A'.repeat(31));
      expect(result.success).toBe(false);
      expect(result.message).toBe('DISPLAY_NAME_TOO_LONG');
    });

    it('should reject invalid characters', async () => {
      const result = await service.changeDisplayName(1, 'Test<>Name');
      expect(result.success).toBe(false);
      expect(result.message).toBe('DISPLAY_NAME_INVALID_CHARS');
    });

    it('should reject same display name', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, fullName: 'Test User' });
      const result = await service.changeDisplayName(1, 'Test User');
      expect(result.success).toBe(false);
      expect(result.message).toBe('DISPLAY_NAME_SAME');
    });

    it('should enforce cooldown when display name was recently changed', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 2);
      userRepo.findOne.mockResolvedValue({
        ...mockUser,
        fullName: 'Current Name',
        displayNameLastChangedAt: recentDate,
      });
      const result = await service.changeDisplayName(1, 'New Name');
      expect(result.success).toBe(false);
      expect(result.message).toBe('DISPLAY_NAME_COOLDOWN');
    });

    it('should return error when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.changeDisplayName(999, 'New Name');
      expect(result.success).toBe(false);
    });
  });

  // ===================== REMOVE DISPLAY NAME =====================
  describe('removeDisplayName', () => {
    it('should remove display name successfully', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, fullName: 'My Name', displayNameLastChangedAt: null });
      const result = await service.removeDisplayName(1);
      expect(result.success).toBe(true);
      expect(result.message).toBe('DISPLAY_NAME_REMOVED');
    });

    it('should fail when no display name set', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, fullName: null });
      const result = await service.removeDisplayName(1);
      expect(result.success).toBe(false);
      expect(result.message).toBe('DISPLAY_NAME_EMPTY');
    });

    it('should enforce cooldown', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 2);
      userRepo.findOne.mockResolvedValue({
        ...mockUser,
        fullName: 'Name',
        displayNameLastChangedAt: recentDate,
      });
      const result = await service.removeDisplayName(1);
      expect(result.success).toBe(false);
      expect(result.message).toBe('DISPLAY_NAME_COOLDOWN');
    });

    it('should return error when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.removeDisplayName(999);
      expect(result.success).toBe(false);
    });
  });

  // ===================== CHANGE USERNAME =====================
  describe('changeUsername', () => {
    it('should change username successfully', async () => {
      userRepo.findOne
        .mockResolvedValueOnce({ ...mockUser, usernameLastChangedAt: null }) // find user
        .mockResolvedValueOnce({ ...mockUser, usernameLastChangedAt: null }) // getUsernameChangeInfo
        .mockResolvedValueOnce(null); // new username availability check

      const result = await service.changeUsername(1, 'newname');
      expect(result.success).toBe(true);
      expect(cacheManager.del).toHaveBeenCalled();
    });

    it('should reject invalid username format', async () => {
      const result = await service.changeUsername(1, 'ab');
      expect(result.success).toBe(false);
    });

    it('should reject numeric-only username', async () => {
      const result = await service.changeUsername(1, '12345');
      expect(result.success).toBe(false);
    });

    it('should reject same username', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.changeUsername(1, 'testuser');
      expect(result.success).toBe(false);
    });

    it('should deny username change during cooldown', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 5);
      userRepo.findOne
        .mockResolvedValueOnce({ ...mockUser, usernameLastChangedAt: recentDate })
        .mockResolvedValueOnce({ ...mockUser, usernameLastChangedAt: recentDate }); // getUsernameChangeInfo call

      const result = await service.changeUsername(1, 'newname');
      expect(result.success).toBe(false);
    });

    it('should reject taken username', async () => {
      userRepo.findOne
        .mockResolvedValueOnce({ ...mockUser, usernameLastChangedAt: null })
        .mockResolvedValueOnce({ ...mockUser, usernameLastChangedAt: null }) // changeInfo
        .mockResolvedValueOnce({ id: 99, username: 'taken' }); // availability

      const result = await service.changeUsername(1, 'taken');
      expect(result.success).toBe(false);
    });
  });

  // ===================== CHANGE PASSWORD =====================
  describe('changePassword', () => {
    it('should change password successfully', async () => {
      const hashed = await bcrypt.hash('currentPass', 10);
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: hashed });

      const result = await service.changePassword(1, 'currentPass', 'newPass123');
      expect(result.success).toBe(true);
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('should fail with wrong current password', async () => {
      const hashed = await bcrypt.hash('correctPass', 10);
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: hashed });

      const result = await service.changePassword(1, 'wrongPass', 'newPass');
      expect(result.success).toBe(false);
    });

    it('should fail for OAuth user without password', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: null });
      const result = await service.changePassword(1, 'any', 'new');
      expect(result.success).toBe(false);
    });

    it('should fail when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.changePassword(999, 'x', 'y');
      expect(result.success).toBe(false);
    });
  });

  // ===================== HAS PASSWORD =====================
  describe('hasPassword', () => {
    it('should return true when user has password', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      expect(await service.hasPassword(1)).toBe(true);
    });

    it('should return false when user has no password', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: null });
      expect(await service.hasPassword(1)).toBe(false);
    });

    it('should return false for empty string password', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: '   ' });
      expect(await service.hasPassword(1)).toBe(false);
    });

    it('should return false when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      expect(await service.hasPassword(999)).toBe(false);
    });
  });

  // ===================== SET PASSWORD =====================
  describe('setPassword', () => {
    it('should set password for OAuth user', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: null });
      const result = await service.setPassword(1, 'newPass123');
      expect(result.success).toBe(true);
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('should reject if user already has password', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.setPassword(1, 'newPass');
      expect(result.success).toBe(false);
    });

    it('should fail when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.setPassword(999, 'pass');
      expect(result.success).toBe(false);
    });
  });

  // ===================== VERIFY OTP =====================
  describe('verifyOtp', () => {
    it('should return failure when no stored OTP', async () => {
      const result = await service.verifyOtp('test@test.com', '123456');
      expect(result.success).toBe(false);
    });
  });

  // ===================== GENERATE PASSWORD RESET OTP =====================
  describe('generatePasswordResetOtp', () => {
    it('should generate OTP and send email', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.generatePasswordResetOtp('test@test.com');
      expect(result.success).toBe(true);
      expect(emailService.sendOtpEmail).toHaveBeenCalled();
    });

    it('should fail when email not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.generatePasswordResetOtp('nope@test.com');
      expect(result.success).toBe(false);
    });

    it('should fail when email sending fails', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      emailService.sendOtpEmail.mockResolvedValue(false);
      const result = await service.generatePasswordResetOtp('test@test.com');
      expect(result.success).toBe(false);
    });
  });

  // ===================== VERIFY OTP AND RESET PASSWORD =====================
  describe('verifyOtpAndResetPassword', () => {
    it('should return failure when no OTP stored', async () => {
      const result = await service.verifyOtpAndResetPassword('test@test.com', '123456', 'newPass');
      expect(result.success).toBe(false);
    });
  });

  // ===================== BLOCK / UNBLOCK =====================
  describe('blockUser', () => {
    it('should block a user', async () => {
      blockedUserRepo.findOne.mockResolvedValue(null);
      await service.blockUser(1, 2);
      expect(blockedUserRepo.save).toHaveBeenCalled();
    });

    it('should silently return if already blocked', async () => {
      blockedUserRepo.findOne.mockResolvedValue({ id: 1 });
      await service.blockUser(1, 2);
      expect(blockedUserRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('unblockUser', () => {
    it('should unblock a user', async () => {
      await service.unblockUser(1, 2);
      expect(blockedUserRepo.delete).toHaveBeenCalledWith({ blockerId: 1, blockedId: 2 });
    });
  });

  // ===================== GET BLOCKED USERS =====================
  describe('getBlockedUsers', () => {
    it('should return blocked users list', async () => {
      blockedUserRepo.find.mockResolvedValue([
        { blockedId: 2, createdAt: new Date() },
        { blockedId: 3, createdAt: new Date() },
      ]);
      userRepo.findOne
        .mockResolvedValueOnce({ id: 2, username: 'user2', avatar: 'av2.jpg' })
        .mockResolvedValueOnce({ id: 3, username: 'user3', avatar: null });

      const result = await service.getBlockedUsers(1);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('username');
    });

    it('should filter out null entries (deleted users)', async () => {
      blockedUserRepo.find.mockResolvedValue([
        { blockedId: 2, createdAt: new Date() },
      ]);
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.getBlockedUsers(1);
      expect(result).toHaveLength(0);
    });
  });

  describe('isUserBlocked', () => {
    it('should return true when user is blocked', async () => {
      blockedUserRepo.findOne.mockResolvedValue({ id: 1 });
      expect(await service.isUserBlocked(1, 2)).toBe(true);
    });

    it('should return false when user is not blocked', async () => {
      blockedUserRepo.findOne.mockResolvedValue(null);
      expect(await service.isUserBlocked(1, 2)).toBe(false);
    });
  });

  // ===================== USER SETTINGS =====================
  describe('getUserSettings', () => {
    it('should return cached settings on cache hit', async () => {
      cacheManager.get.mockResolvedValue(mockSettings);
      const result = await service.getUserSettings(1);
      expect(result).toEqual(mockSettings);
      expect(settingsRepo.findOne).not.toHaveBeenCalled();
    });

    it('should find settings from DB and cache them', async () => {
      cacheManager.get.mockResolvedValue(null);
      settingsRepo.findOne.mockResolvedValue(mockSettings);
      const result = await service.getUserSettings(1);
      expect(result).toEqual(mockSettings);
      expect(cacheManager.set).toHaveBeenCalledWith('user:settings:1', mockSettings, 1800000);
    });

    it('should create default settings if none exist', async () => {
      cacheManager.get.mockResolvedValue(null);
      settingsRepo.findOne.mockResolvedValue(null);
      settingsRepo.save.mockResolvedValue(mockSettings);
      const result = await service.getUserSettings(1);
      expect(settingsRepo.create).toHaveBeenCalled();
    });
  });

  // ===================== UPDATE USER SETTINGS =====================
  describe('updateUserSettings', () => {
    it('should update existing settings', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings });
      const result = await service.updateUserSettings(1, { theme: 'light' } as any);
      expect(settingsRepo.save).toHaveBeenCalled();
      expect(cacheManager.del).toHaveBeenCalledWith('user:settings:1');
    });

    it('should create new settings when none exist', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const result = await service.updateUserSettings(1, { theme: 'light' } as any);
      expect(settingsRepo.create).toHaveBeenCalled();
      expect(settingsRepo.save).toHaveBeenCalled();
    });

    it('should auto-approve pending requests when requireFollowApproval turned off', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings });
      followRepo.find.mockResolvedValue([
        { followerId: 2, followingId: 1, status: 'pending' },
        { followerId: 3, followingId: 1, status: 'pending' },
      ]);

      await service.updateUserSettings(1, { requireFollowApproval: false } as any);
      expect(followRepo.find).toHaveBeenCalled();
      expect(followRepo.save).toHaveBeenCalled();
    });

    it('should update granular notification preferences', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings });
      await service.updateUserSettings(1, {
        pushLikes: false,
        pushComments: false,
        whoCanViewVideos: 'friends',
        whoCanSendMessages: 'noOne',
      } as any);
      expect(settingsRepo.save).toHaveBeenCalled();
    });
  });

  // ===================== LINK EMAIL =====================
  describe('linkEmail', () => {
    it('should link email to existing user', async () => {
      userRepo.findOne
        .mockResolvedValueOnce({ ...mockUser, email: null })  // find user
        .mockResolvedValueOnce(null); // check email availability

      const result = await service.linkEmail(1, 'newemail@test.com', 'hashPass');
      expect(result.success).toBe(true);
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('should fail when email already used by another user', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(mockUser) // find user
        .mockResolvedValueOnce({ id: 99, email: 'taken@test.com' }); // email exists

      const result = await service.linkEmail(1, 'taken@test.com');
      expect(result.success).toBe(false);
    });

    it('should fail when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.linkEmail(999, 'email@test.com');
      expect(result.success).toBe(false);
    });
  });

  // ===================== LINK PHONE =====================
  describe('linkPhone', () => {
    it('should link phone to existing user', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null); // phone availability

      const result = await service.linkPhone(1, '+84123456789', 'fb_uid');
      expect(result.success).toBe(true);
    });

    it('should fail when phone already used', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ id: 99, phoneNumber: '+84123' }); // phone exists

      const result = await service.linkPhone(1, '+84123');
      expect(result.success).toBe(false);
    });

    it('should fail when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.linkPhone(999, '+84123');
      expect(result.success).toBe(false);
    });
  });

  // ===================== UNLINK PHONE =====================
  describe('unlinkPhone', () => {
    it('should unlink phone successfully', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, phoneNumber: '+84123', authProvider: 'email' });
      const result = await service.unlinkPhone(1);
      expect(result.success).toBe(true);
    });

    it('should clear providerId when auth is phone', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, phoneNumber: '+84123', authProvider: 'phone', providerId: 'fb_id' });
      const result = await service.unlinkPhone(1);
      expect(result.success).toBe(true);
      const savedEntity = userRepo.save.mock.calls[0][0];
      expect(savedEntity.providerId).toBeNull();
    });

    it('should fail when no phone linked', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, phoneNumber: null });
      const result = await service.unlinkPhone(1);
      expect(result.success).toBe(false);
    });

    it('should fail when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.unlinkPhone(999);
      expect(result.success).toBe(false);
    });
  });

  // ===================== LINK GOOGLE =====================
  describe('linkGoogleToExistingAccount', () => {
    it('should link Google account and invalidate cache', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      await service.linkGoogleToExistingAccount(1, 'google_provider_id');
      expect(cacheManager.del).toHaveBeenCalledWith('user:id:1');
    });

    it('should return silently when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await service.linkGoogleToExistingAccount(999, 'gid');
      expect(cacheManager.del).not.toHaveBeenCalled();
    });
  });

  // ===================== GET ACCOUNT INFO =====================
  describe('getAccountInfo', () => {
    it('should return full account info', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.getAccountInfo(1);
      expect(result).toHaveProperty('username');
      expect(result).toHaveProperty('hasPassword');
      expect(result).toHaveProperty('twoFactorEnabled');
    });

    it('should replace placeholder phone email with null', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, email: 'phone123@phone.user' });
      const result = await service.getAccountInfo(1);
      expect(result.email).toBeNull();
    });

    it('should return null when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.getAccountInfo(999);
      expect(result).toBeNull();
    });
  });

  // ===================== 2FA SETTINGS =====================
  describe('update2FASettings', () => {
    it('should update 2FA settings', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.update2FASettings(1, true, ['email', 'totp']);
      expect(result.success).toBe(true);
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('should set methods to null when empty', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      await service.update2FASettings(1, false, []);
      const savedEntity = userRepo.save.mock.calls[0][0];
      expect(savedEntity.twoFactorMethods).toBeNull();
    });

    it('should fail when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.update2FASettings(999, true, ['email']);
      expect(result.success).toBe(false);
    });
  });

  describe('get2FASettings', () => {
    it('should return 2FA settings', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, twoFactorEnabled: true, twoFactorMethods: ['email'] });
      const result = await service.get2FASettings(1);
      expect(result).toEqual({ enabled: true, methods: ['email'] });
    });

    it('should return null when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.get2FASettings(999);
      expect(result).toBeNull();
    });
  });

  // ===================== TOTP SECRET =====================
  describe('setTotpSecret', () => {
    it('should set TOTP secret', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      const result = await service.setTotpSecret(1, 'ABCDEF123456');
      expect(result).toBe(true);
    });

    it('should return false when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.setTotpSecret(999, 'secret');
      expect(result).toBe(false);
    });
  });

  describe('getTotpSecret', () => {
    it('should return TOTP secret', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, totpSecret: 'SECRET123' });
      const result = await service.getTotpSecret(1);
      expect(result).toBe('SECRET123');
    });

    it('should return null when user has no secret', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, totpSecret: null });
      const result = await service.getTotpSecret(1);
      expect(result).toBeNull();
    });

    it('should return null when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.getTotpSecret(999);
      expect(result).toBeNull();
    });
  });

  // ===================== RESET PASSWORD BY PHONE =====================
  describe('resetPasswordByPhone', () => {
    it('should reset password by phone', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, phoneNumber: '+84123' });
      const result = await service.resetPasswordByPhone('+84123', 'newPass');
      expect(result.success).toBe(true);
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('should fail when phone not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.resetPasswordByPhone('+84999', 'newPass');
      expect(result.success).toBe(false);
    });
  });

  // ===================== PHONE EXISTS =====================
  describe('phoneExists', () => {
    it('should return true when phone exists', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      expect(await service.phoneExists('+84123')).toBe(true);
    });

    it('should return false when phone not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      expect(await service.phoneExists('+84999')).toBe(false);
    });
  });

  // ===================== UPDATE LAST SEEN =====================
  describe('updateLastSeen', () => {
    it('should update lastSeen and invalidate cache', async () => {
      await service.updateLastSeen(1);
      expect(userRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ lastSeen: expect.any(Date) }));
      expect(cacheManager.del).toHaveBeenCalledWith('user:id:1');
    });

    it('should handle errors gracefully', async () => {
      userRepo.update.mockRejectedValue(new Error('DB error'));
      await expect(service.updateLastSeen(1)).resolves.toBeUndefined();
    });
  });

  // ===================== GET ONLINE STATUS =====================
  describe('getOnlineStatus', () => {
    it('should return online for recent activity', async () => {
      const now = new Date();
      userRepo.findOne.mockResolvedValue({ id: 1, lastSeen: now });

      const result = await service.getOnlineStatus(1);
      expect(result.isOnline).toBe(true);
      expect(result.statusText).toBe('Online');
    });

    it('should return offline with time ago status', async () => {
      const past = new Date();
      past.setMinutes(past.getMinutes() - 30);
      userRepo.findOne.mockResolvedValue({ id: 1, lastSeen: past });

      const result = await service.getOnlineStatus(1);
      expect(result.isOnline).toBe(false);
      expect(result.statusText).toContain('phút trước');
    });

    it('should return hours ago for older activity', async () => {
      const past = new Date();
      past.setHours(past.getHours() - 3);
      userRepo.findOne.mockResolvedValue({ id: 1, lastSeen: past });

      const result = await service.getOnlineStatus(1);
      expect(result.statusText).toContain('giờ trước');
    });

    it('should return days ago for very old activity', async () => {
      const past = new Date();
      past.setDate(past.getDate() - 5);
      userRepo.findOne.mockResolvedValue({ id: 1, lastSeen: past });

      const result = await service.getOnlineStatus(1);
      expect(result.statusText).toContain('ngày trước');
    });

    it('should hide online status when disabled by privacy settings', async () => {
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings, showOnlineStatus: false });

      const result = await service.getOnlineStatus(2, 1); // requester 1 checking user 2
      expect(result.isOnline).toBe(false);
      expect(result.lastSeen).toBeNull();
    });

    it('should return offline when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.getOnlineStatus(999);
      expect(result.isOnline).toBe(false);
    });

    it('should return offline when no lastSeen', async () => {
      userRepo.findOne.mockResolvedValue({ id: 1, lastSeen: null });
      const result = await service.getOnlineStatus(1);
      expect(result.isOnline).toBe(false);
    });
  });

  // ===================== DEACTIVATE ACCOUNT =====================
  describe('deactivateAccount', () => {
    it('should deactivate account with correct password', async () => {
      const hashed = await bcrypt.hash('password123', 10);
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: hashed });

      const result = await service.deactivateAccount(1, 'password123');
      expect(result.success).toBe(true);
      expect(userRepo.save).toHaveBeenCalled();
      expect(sessionsService.logoutAllSessions).toHaveBeenCalledWith(1);
    });

    it('should fail with wrong password', async () => {
      const hashed = await bcrypt.hash('correct', 10);
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: hashed });

      const result = await service.deactivateAccount(1, 'wrong');
      expect(result.success).toBe(false);
    });

    it('should allow deactivation for OAuth users without password', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: null, authProvider: 'google' });
      const result = await service.deactivateAccount(1, '');
      expect(result.success).toBe(true);
    });

    it('should fail when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.deactivateAccount(999, 'pass');
      expect(result.success).toBe(false);
    });

    it('should handle session logout errors gracefully', async () => {
      const hashed = await bcrypt.hash('pass', 10);
      userRepo.findOne.mockResolvedValue({ ...mockUser, password: hashed });
      sessionsService.logoutAllSessions.mockRejectedValue(new Error('Session error'));

      const result = await service.deactivateAccount(1, 'pass');
      expect(result.success).toBe(true);
    });
  });

  // ===================== REACTIVATE ACCOUNT =====================
  describe('reactivateAccount', () => {
    it('should reactivate account within 30-day grace period', async () => {
      const hashed = await bcrypt.hash('pass', 10);
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      userRepo.findOne.mockResolvedValue({
        ...mockUser,
        password: hashed,
        isDeactivated: true,
        deactivatedAt: fiveDaysAgo,
      });

      const result = await service.reactivateAccount({ email: 'test@test.com', password: 'pass' });
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
    });

    it('should fail if account not deactivated', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, isDeactivated: false });
      const result = await service.reactivateAccount({ email: 'test@test.com', password: 'pass' });
      expect(result.success).toBe(false);
    });

    it('should fail after 30-day grace period', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      userRepo.findOne.mockResolvedValue({
        ...mockUser,
        isDeactivated: true,
        deactivatedAt: oldDate,
      });

      const result = await service.reactivateAccount({ email: 'test@test.com', password: 'pass' });
      expect(result.success).toBe(false);
    });

    it('should fail with wrong password', async () => {
      const hashed = await bcrypt.hash('correct', 10);
      userRepo.findOne.mockResolvedValue({
        ...mockUser,
        password: hashed,
        isDeactivated: true,
        deactivatedAt: new Date(),
      });

      const result = await service.reactivateAccount({ email: 'test@test.com', password: 'wrong' });
      expect(result.success).toBe(false);
    });

    it('should find by username', async () => {
      const hashed = await bcrypt.hash('pass', 10);
      userRepo.findOne.mockResolvedValue({
        ...mockUser,
        password: hashed,
        isDeactivated: true,
        deactivatedAt: new Date(),
      });

      const result = await service.reactivateAccount({ username: 'testuser', password: 'pass' });
      expect(result.success).toBe(true);
    });

    it('should find by phone', async () => {
      const hashed = await bcrypt.hash('pass', 10);
      userRepo.findOne.mockResolvedValue({
        ...mockUser,
        password: hashed,
        isDeactivated: true,
        deactivatedAt: new Date(),
      });

      const result = await service.reactivateAccount({ phone: '+84123', password: 'pass' });
      expect(result.success).toBe(true);
    });

    it('should fail when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.reactivateAccount({ email: 'none@test.com', password: 'pass' });
      expect(result.success).toBe(false);
    });
  });

  // ===================== CHECK DEACTIVATED STATUS =====================
  describe('checkDeactivatedStatus', () => {
    it('should return deactivated true with days remaining', async () => {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      userRepo.findOne.mockResolvedValue({
        id: 1,
        isDeactivated: true,
        deactivatedAt: fiveDaysAgo,
      });

      const result = await service.checkDeactivatedStatus('test@test.com');
      expect(result.isDeactivated).toBe(true);
      expect(result.daysRemaining).toBe(25);
    });

    it('should return not deactivated when user is active', async () => {
      userRepo.findOne.mockResolvedValue({ id: 1, isDeactivated: false });
      const result = await service.checkDeactivatedStatus('test@test.com');
      expect(result.isDeactivated).toBe(false);
    });

    it('should return not deactivated when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.checkDeactivatedStatus('nobody@test.com');
      expect(result.isDeactivated).toBe(false);
    });
  });

  // ===================== PRIVACY SETTINGS =====================
  describe('getPrivacySettings', () => {
    it('should return privacy settings', async () => {
      settingsRepo.findOne.mockResolvedValue(mockSettings);
      const result = await service.getPrivacySettings(1);
      expect(result).toHaveProperty('accountPrivacy');
      expect(result).toHaveProperty('whoCanViewVideos');
    });

    it('should return defaults when no settings exist', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const result = await service.getPrivacySettings(1);
      expect(result.accountPrivacy).toBe('public');
      expect(result.whoCanViewVideos).toBe('everyone');
    });
  });

  // ===================== CHECK PRIVACY PERMISSION =====================
  describe('checkPrivacyPermission', () => {
    it('should always allow owner', async () => {
      const result = await service.checkPrivacyPermission(1, 1, 'view_video');
      expect(result.allowed).toBe(true);
    });

    it('should block when requester blocks target', async () => {
      blockedUserRepo.findOne
        .mockResolvedValueOnce({ id: 1 })  // requester blocked target
        .mockResolvedValueOnce(null);

      const result = await service.checkPrivacyPermission(1, 2, 'view_video');
      expect(result.allowed).toBe(false);
    });

    it('should block when target blocks requester', async () => {
      blockedUserRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 2 }); // target blocked requester

      const result = await service.checkPrivacyPermission(1, 2, 'view_video');
      expect(result.allowed).toBe(false);
    });

    it('should block when target user is deactivated', async () => {
      blockedUserRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 2, isDeactivated: true });

      const result = await service.checkPrivacyPermission(1, 2, 'view_video');
      expect(result.allowed).toBe(false);
      expect(result.isDeactivated).toBe(true);
    });

    it('should deny non-follower on private account', async () => {
      blockedUserRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 2, isDeactivated: false });
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings, accountPrivacy: 'private' });
      followRepo.findOne.mockResolvedValue(null); // not following

      const result = await service.checkPrivacyPermission(1, 2, 'view_video');
      expect(result.allowed).toBe(false);
      expect(result.isPrivateAccount).toBe(true);
    });

    it('should allow everyone when setting is everyone', async () => {
      blockedUserRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 2, isDeactivated: false });
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings, whoCanViewVideos: 'everyone' });
      followRepo.findOne.mockResolvedValue(null);

      const result = await service.checkPrivacyPermission(1, 2, 'view_video');
      expect(result.allowed).toBe(true);
    });

    it('should allow friend when setting is friends', async () => {
      blockedUserRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 2, isDeactivated: false });
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings, whoCanSendMessages: 'friends' });
      followRepo.findOne
        .mockResolvedValueOnce({ followerId: 1, followingId: 2 }) // requester follows target
        .mockResolvedValueOnce({ followerId: 2, followingId: 1 }); // target follows requester (mutual)

      const result = await service.checkPrivacyPermission(1, 2, 'send_message');
      expect(result.allowed).toBe(true);
    });

    it('should deny non-friend when setting is friends', async () => {
      blockedUserRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 2, isDeactivated: false });
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings, whoCanComment: 'friends' });
      followRepo.findOne
        .mockResolvedValueOnce(null) // not following
        .mockResolvedValueOnce(null);

      const result = await service.checkPrivacyPermission(1, 2, 'comment');
      expect(result.allowed).toBe(false);
    });

    it('should deny when setting is noOne', async () => {
      blockedUserRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 2, isDeactivated: false });
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings, whoCanViewVideos: 'noOne' });
      followRepo.findOne.mockResolvedValue(null);

      const result = await service.checkPrivacyPermission(1, 2, 'view_video');
      expect(result.allowed).toBe(false);
    });

    it('should deny when setting is onlyMe', async () => {
      blockedUserRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 2, isDeactivated: false });
      settingsRepo.findOne.mockResolvedValue({ ...mockSettings, whoCanSendMessages: 'onlyMe' });
      followRepo.findOne.mockResolvedValue(null);

      const result = await service.checkPrivacyPermission(1, 2, 'send_message');
      expect(result.allowed).toBe(false);
    });
  });

  // ===================== PRIVACY SETTINGS BATCH =====================
  describe('getPrivacySettingsBatch', () => {
    it('should return settings for multiple users', async () => {
      settingsRepo.find.mockResolvedValue([
        { userId: 1, accountPrivacy: 'public', whoCanViewVideos: 'everyone', whoCanSendMessages: 'everyone', whoCanComment: 'everyone', filterComments: true },
        { userId: 2, accountPrivacy: 'private', whoCanViewVideos: 'friends', whoCanSendMessages: 'friends', whoCanComment: 'friends', filterComments: false },
      ]);

      const result = await service.getPrivacySettingsBatch([1, 2]);
      expect(result.size).toBe(2);
      expect(result.get(1)?.accountPrivacy).toBe('public');
      expect(result.get(2)?.accountPrivacy).toBe('private');
    });

    it('should return defaults for users without settings', async () => {
      settingsRepo.find.mockResolvedValue([]);
      const result = await service.getPrivacySettingsBatch([1]);
      expect(result.get(1)?.accountPrivacy).toBe('public');
    });

    it('should return empty map for empty input', async () => {
      const result = await service.getPrivacySettingsBatch([]);
      expect(result.size).toBe(0);
    });
  });

  // ===================== GET DEACTIVATED USER IDS =====================
  describe('getDeactivatedUserIds', () => {
    it('should return deactivated user IDs via query builder', async () => {
      createQueryBuilder.getMany.mockResolvedValue([{ id: 2 }, { id: 5 }]);

      const result = await service.getDeactivatedUserIds([1, 2, 3, 5]);
      expect(result).toEqual([2, 5]);
    });

    it('should return empty array when no IDs provided', async () => {
      const result = await service.getDeactivatedUserIds([]);
      expect(result).toEqual([]);
    });

    it('should deduplicate input IDs', async () => {
      createQueryBuilder.getMany.mockResolvedValue([{ id: 2 }]);
      const result = await service.getDeactivatedUserIds([2, 2, 2]);
      expect(result).toEqual([2]);
    });
  });

  // ===================== SEARCH USERS =====================
  describe('searchUsers', () => {
    it('should search users with query builder', async () => {
      createQueryBuilder.getMany.mockResolvedValue([
        { id: 1, username: 'testuser', password: 'hash', email: 'test@test.com' },
      ]);
      const result = await service.searchUsers('test');
      expect(userRepo.createQueryBuilder).toHaveBeenCalled();
      expect(result[0]).not.toHaveProperty('password');
    });

    it('should return empty array for empty query', async () => {
      const result = await service.searchUsers('');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace-only query', async () => {
      const result = await service.searchUsers('   ');
      expect(result).toEqual([]);
    });
  });

  // ===================== CONTAINS BAD WORDS (via changeDisplayName) =====================
  describe('containsBadWords (via changeDisplayName)', () => {
    it('should reject display name with bad words (no AI key)', async () => {
      configService.get.mockReturnValue(null); // no GEMINI_API_KEY
      userRepo.findOne.mockResolvedValue({ ...mockUser, fullName: 'Old', displayNameLastChangedAt: null });
      const result = await service.changeDisplayName(1, 'fuck you');
      expect(result.success).toBe(false);
      expect(result.message).toBe('DISPLAY_NAME_INAPPROPRIATE');
    });

    it('should allow clean display name', async () => {
      configService.get.mockReturnValue(null);
      userRepo.findOne.mockResolvedValue({ ...mockUser, fullName: 'Old', displayNameLastChangedAt: null });
      const result = await service.changeDisplayName(1, 'Nice Name');
      expect(result.success).toBe(true);
    });
  });
});

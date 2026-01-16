import { Injectable, ConflictException, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from '../auth/dto/create-user.dto';
import { User } from '../entities/user.entity';
import { BlockedUser } from '../entities/blocked-user.entity';
import { UserSettings } from '../entities/user-settings.entity';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(BlockedUser)
    private blockedUserRepository: Repository<BlockedUser>,
    @InjectRepository(UserSettings)
    private userSettingsRepository: Repository<UserSettings>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) { }

  async create(createUserDto: CreateUserDto) {
    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: [
        { username: createUserDto.username },
        { email: createUserDto.email }
      ]
    });

    if (existingUser) {
      throw new ConflictException('Username or email already exists');
    }

    // Hash password
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(createUserDto.password, salt);

    // Create new user
    const user = this.userRepository.create({
      username: createUserDto.username,
      email: createUserDto.email,
      password: hashedPassword,
    });

    const savedUser = await this.userRepository.save(user);
    console.log('Created user:', savedUser);

    // Return user without password
    const { password, ...result } = savedUser;
    return result;
  }

  async findOne(username: string): Promise<User | null> {
    // ✅ Check cache first
    const cacheKey = `user:username:${username}`;
    const cachedUser = await this.cacheManager.get<User>(cacheKey);

    if (cachedUser) {
      console.log(`✅ Cache HIT for username ${username}`);
      return cachedUser;
    }

    console.log(`⚠️ Cache MISS for username ${username} - fetching from DB`);
    const user = await this.userRepository.findOne({
      where: { username }
    });

    if (user) {
      // ✅ Store in cache for 10 minutes (user data rarely changes)
      await this.cacheManager.set(cacheKey, user, 600000);
    }

    return user;
  }

  async findById(id: number): Promise<User | null> {
    // ✅ Check cache first
    const cacheKey = `user:id:${id}`;
    const cachedUser = await this.cacheManager.get<User>(cacheKey);

    if (cachedUser) {
      console.log(`✅ Cache HIT for user ID ${id}`);
      return cachedUser;
    }

    console.log(`⚠️ Cache MISS for user ID ${id} - fetching from DB`);
    const user = await this.userRepository.findOne({
      where: { id }
    });

    if (user) {
      // ✅ Store in cache for 10 minutes
      await this.cacheManager.set(cacheKey, user, 600000);
      // ✅ Also cache by username for faster lookup
      await this.cacheManager.set(`user:username:${user.username}`, user, 600000);
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email }
    });
  }

  async updateAvatar(userId: number, avatarPath: string): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.avatar = avatarPath;
    const updatedUser = await this.userRepository.save(user);

    // ✅ Invalidate cache
    await this.cacheManager.del(`user:id:${userId}`);
    await this.cacheManager.del(`user:username:${user.username}`);

    return updatedUser;
  }

  async removeAvatar(userId: number): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.avatar = null;
    const updatedUser = await this.userRepository.save(user);

    // ✅ Invalidate cache
    await this.cacheManager.del(`user:id:${userId}`);
    await this.cacheManager.del(`user:username:${user.username}`);

    return updatedUser;
  }

  async updateProfile(userId: number, updateData: { bio?: string; avatar?: string; website?: string; location?: string; gender?: string }) {
    try {
      console.log(`📝 Updating profile for user ${userId}`, updateData);

      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new Error('User not found');
      }

      if (updateData.bio !== undefined) {
        user.bio = updateData.bio;
      }

      if (updateData.avatar !== undefined) {
        user.avatar = updateData.avatar;
      }

      if (updateData.website !== undefined) {
        user.website = updateData.website;
      }

      if (updateData.location !== undefined) {
        user.location = updateData.location;
      }

      if (updateData.gender !== undefined) {
        user.gender = updateData.gender;
      }

      const updatedUser = await this.userRepository.save(user);
      console.log(`✅ Profile updated for user ${userId}`);

      // ✅ Invalidate cache when user data changes
      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${updatedUser.username}`);
      console.log(`🗑️ Cache invalidated for user ${userId}`);

      return {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        avatar: updatedUser.avatar,
        bio: updatedUser.bio,
        website: updatedUser.website,
        location: updatedUser.location,
        gender: updatedUser.gender,
      };
    } catch (error) {
      console.error('❌ Error updating profile:', error);
      throw error;
    }
  }

  // Change password
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { success: false, message: 'Không tìm thấy người dùng' };
      }

      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        return { success: false, message: 'Mật khẩu hiện tại không đúng' };
      }

      // Hash new password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      user.password = hashedPassword;
      await this.userRepository.save(user);

      // Invalidate cache
      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${user.username}`);

      console.log(`✅ Password changed for user ${userId}`);
      return { success: true, message: 'Đổi mật khẩu thành công' };
    } catch (error) {
      console.error('❌ Error changing password:', error);
      return { success: false, message: 'Lỗi khi đổi mật khẩu' };
    }
  }

  // Block a user
  async blockUser(blockerId: number, blockedId: number): Promise<void> {
    // Check if already blocked
    const existing = await this.blockedUserRepository.findOne({
      where: { blockerId, blockedId },
    });

    if (existing) {
      return; // Already blocked
    }

    const blockedUser = this.blockedUserRepository.create({
      blockerId,
      blockedId,
    });

    await this.blockedUserRepository.save(blockedUser);
    console.log(`✅ User ${blockerId} blocked user ${blockedId}`);
  }

  // Unblock a user
  async unblockUser(blockerId: number, blockedId: number): Promise<void> {
    await this.blockedUserRepository.delete({ blockerId, blockedId });
    console.log(`✅ User ${blockerId} unblocked user ${blockedId}`);
  }

  // Get list of blocked users
  async getBlockedUsers(userId: number): Promise<any[]> {
    const blockedEntries = await this.blockedUserRepository.find({
      where: { blockerId: userId },
    });

    const blockedUsers = await Promise.all(
      blockedEntries.map(async (entry) => {
        const user = await this.userRepository.findOne({
          where: { id: entry.blockedId },
        });
        if (user) {
          return {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatar,
            blockedAt: entry.createdAt,
          };
        }
        return null;
      }),
    );

    return blockedUsers.filter((u) => u !== null);
  }

  // Check if a user is blocked
  async isUserBlocked(blockerId: number, blockedId: number): Promise<boolean> {
    const blocked = await this.blockedUserRepository.findOne({
      where: { blockerId, blockedId },
    });
    return !!blocked;
  }

  // ============= USER SETTINGS METHODS =============

  // Get user settings
  async getUserSettings(userId: number): Promise<UserSettings> {
    // Check cache first
    const cacheKey = `user:settings:${userId}`;
    console.log(`🔍 Checking cache for user settings ${userId} with key: ${cacheKey}`);
    const cachedSettings = await this.cacheManager.get<UserSettings>(cacheKey);

    if (cachedSettings) {
      console.log(`✅ Cache HIT for user settings ${userId}:`, cachedSettings);
      return cachedSettings;
    }

    console.log(`⚠️ Cache MISS for user settings ${userId} - fetching from DB`);
    let settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });

    // If settings don't exist, create default settings
    if (!settings) {
      console.log(`🆕 Creating default settings for user ${userId}`);
      settings = this.userSettingsRepository.create({
        userId,
        theme: 'dark',
        notificationsEnabled: true,
        pushNotifications: true,
        emailNotifications: true,
        accountPrivacy: 'public',
        showOnlineStatus: true,
        autoplayVideos: true,
        videoQuality: 'medium',
        language: 'vi',
      });
      settings = await this.userSettingsRepository.save(settings);
      console.log(`✅ Default settings created for user ${userId}:`, settings);
    } else {
      console.log(`✅ Settings loaded from DB for user ${userId}:`, settings);
    }

    // Cache for 30 minutes
    await this.cacheManager.set(cacheKey, settings, 1800000);
    console.log(`💾 Settings cached for user ${userId} with key: ${cacheKey}`);

    return settings;
  }

  // Update user settings
  async updateUserSettings(
    userId: number,
    updateData: UpdateUserSettingsDto,
  ): Promise<UserSettings> {
    let settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });

    if (!settings) {
      // Create new settings if they don't exist with default values + updates
      settings = this.userSettingsRepository.create({
        userId: userId,
        theme: updateData.theme ?? 'dark',
        notificationsEnabled: updateData.notificationsEnabled ?? true,
        pushNotifications: updateData.pushNotifications ?? true,
        emailNotifications: updateData.emailNotifications ?? true,
        accountPrivacy: updateData.accountPrivacy ?? 'public',
        showOnlineStatus: updateData.showOnlineStatus ?? true,
        autoplayVideos: updateData.autoplayVideos ?? true,
        videoQuality: updateData.videoQuality ?? 'medium',
        language: updateData.language ?? 'vi',
        timezone: updateData.timezone,
      });
      console.log(`🆕 Creating new settings for user ${userId}`);
    } else {
      // Update existing settings
      Object.assign(settings, updateData);
      console.log(`📝 Updating existing settings for user ${userId}`);
    }

    const updatedSettings = await this.userSettingsRepository.save(settings);

    // Invalidate cache
    await this.cacheManager.del(`user:settings:${userId}`);
    console.log(`✅ Settings updated for user ${userId}`, updateData);

    return updatedSettings;
  }
}

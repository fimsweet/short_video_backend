import { Injectable, ConflictException, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from '../auth/dto/create-user.dto';
import { User, AuthProvider } from '../entities/user.entity';
import { BlockedUser } from '../entities/blocked-user.entity';
import { UserSettings } from '../entities/user-settings.entity';
import { Follow } from '../entities/follow.entity';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as bcrypt from 'bcrypt';
import { EmailService } from '../config/email.service';
import { ConfigService } from '@nestjs/config';
import { SessionsService } from '../sessions/sessions.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(BlockedUser)
    private blockedUserRepository: Repository<BlockedUser>,
    @InjectRepository(UserSettings)
    private userSettingsRepository: Repository<UserSettings>,
    @InjectRepository(Follow)
    private followRepository: Repository<Follow>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private emailService: EmailService,
    private configService: ConfigService,
    private sessionsService: SessionsService,
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
      if (existingUser.username === createUserDto.username) {
        throw new ConflictException('Username already exists');
      }
      throw new ConflictException('Email already exists');
    }

    // Check if phone number already exists (if provided)
    if (createUserDto.phoneNumber) {
      const existingPhone = await this.userRepository.findOne({
        where: { phoneNumber: createUserDto.phoneNumber }
      });
      if (existingPhone) {
        throw new ConflictException('Phone number already exists');
      }
    }

    // Hash password
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(createUserDto.password, salt);

    // Create new user with all fields
    const user = this.userRepository.create({
      username: createUserDto.username,
      email: createUserDto.email,
      password: hashedPassword,
      fullName: createUserDto.fullName || null,
      phoneNumber: createUserDto.phoneNumber || null,
      dateOfBirth: createUserDto.dateOfBirth ? new Date(createUserDto.dateOfBirth) : null,
      gender: createUserDto.gender || null,
    });

    const savedUser = await this.userRepository.save(user);
    console.log('Created user:', savedUser);

    // Create user settings with the language from registration (or default 'vi')
    const userSettings = this.userSettingsRepository.create({
      userId: savedUser.id,
      language: createUserDto.language || 'vi',
      theme: 'dark',
    });
    await this.userSettingsRepository.save(userSettings);
    console.log('Created user settings with language:', createUserDto.language || 'vi');

    // Return user without password
    const { password, ...result } = savedUser;
    return result;
  }

  // Check if username is available
  async isUsernameAvailable(username: string): Promise<boolean> {
    const existingUser = await this.userRepository.findOne({
      where: { username: username.toLowerCase() }
    });
    return !existingUser;
  }

  async findOne(username: string): Promise<User | null> {
    // ✅ Check cache first
    const cacheKey = `user:username:${username}`;
    const cachedUser = await this.cacheManager.get<User>(cacheKey);

    if (cachedUser) {
      console.log(`Cache HIT for username ${username}`);
      return cachedUser;
    }

    console.log(`Cache MISS for username ${username} - fetching from DB`);
    const user = await this.userRepository.findOne({
      where: { username }
    });

    if (user) {
      // ✅ Store in cache for 10 minutes (user data rarely changes)
      await this.cacheManager.set(cacheKey, user, 600000);
    }

    return user;
  }

  // Search users by username
  async searchUsers(query: string, limit: number = 20): Promise<any[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchTerm = `%${query.toLowerCase()}%`;

    const users = await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.username) LIKE :search', { search: searchTerm })
      .andWhere('(user.isDeactivated = false OR user.isDeactivated IS NULL)')
      .orderBy('user.username', 'ASC')
      .limit(limit)
      .getMany();

    // Return users without password
    return users.map(({ password, ...user }) => user);
  }

  async findById(id: number): Promise<User | null> {
    // ✅ Check cache first
    const cacheKey = `user:id:${id}`;
    const cachedUser = await this.cacheManager.get<User>(cacheKey);

    if (cachedUser) {
      console.log(`Cache HIT for user ID ${id}`);
      return cachedUser;
    }

    console.log(`Cache MISS for user ID ${id} - fetching from DB`);
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

  // Find user by OAuth provider ID (Google ID, Facebook ID, etc.)
  async findByProviderId(provider: AuthProvider, providerId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: {
        authProvider: provider,
        providerId: providerId,
      }
    });
  }

  // Create OAuth user (Google, Facebook, Apple)
  async createOAuthUser(data: {
    username: string;
    email: string;
    authProvider: AuthProvider;
    providerId: string;
    fullName?: string;
    avatar?: string;
    dateOfBirth?: Date;
  }): Promise<Omit<User, 'password'>> {
    const user = this.userRepository.create({
      username: data.username,
      email: data.email,
      password: null, // OAuth users don't have password
      authProvider: data.authProvider,
      providerId: data.providerId,
      fullName: data.fullName || null,
      avatar: data.avatar || null,
      dateOfBirth: data.dateOfBirth || null,
      isVerified: true, // OAuth users are verified by provider
    });

    const savedUser = await this.userRepository.save(user);

    // Create user settings
    const userSettings = this.userSettingsRepository.create({
      userId: savedUser.id,
      language: 'vi',
      theme: 'dark',
    });
    await this.userSettingsRepository.save(userSettings);

    const { password, ...result } = savedUser;
    return result;
  }

  // Create Email user (TikTok-style registration)
  async createEmailUser(data: {
    username: string;
    email: string;
    password: string;
    dateOfBirth?: Date;
    fullName?: string;
  }): Promise<Omit<User, 'password'>> {
    const user = this.userRepository.create({
      username: data.username,
      email: data.email,
      password: data.password,
      authProvider: 'email' as AuthProvider,
      fullName: data.fullName || null,
      dateOfBirth: data.dateOfBirth || null,
      isVerified: false, // Email users need to verify
    });

    const savedUser = await this.userRepository.save(user);

    // Create user settings
    const userSettings = this.userSettingsRepository.create({
      userId: savedUser.id,
      language: 'vi',
      theme: 'dark',
    });
    await this.userSettingsRepository.save(userSettings);

    const { password, ...result } = savedUser;
    return result;
  }

  // Find user by phone number
  async findByPhone(phone: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { phoneNumber: phone }
    });
  }

  // Create Phone user (Firebase Phone Auth)
  async createPhoneUser(data: {
    username: string;
    phone: string;
    firebaseUid: string;
    dateOfBirth?: Date;
    fullName?: string;
    language?: string;
  }): Promise<Omit<User, 'password'>> {
    // Check if phone number already exists
    const existingPhone = await this.findByPhone(data.phone);
    if (existingPhone) {
      throw new ConflictException('Phone number already registered');
    }

    // Check if username already exists
    const existingUsername = await this.findOne(data.username);
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    // Phone users don't have email - they can link one later
    const user = this.userRepository.create({
      username: data.username,
      email: null, // Phone users don't have email initially
      password: null, // Phone users don't have password
      authProvider: 'phone' as AuthProvider,
      providerId: data.firebaseUid,
      phoneNumber: data.phone,
      fullName: data.fullName || null,
      dateOfBirth: data.dateOfBirth || null,
      isVerified: true, // Phone users are verified via OTP
    });

    const savedUser = await this.userRepository.save(user);
    console.log(`Created phone user: ${savedUser.username} (${data.phone})`);

    // Create user settings
    const userSettings = this.userSettingsRepository.create({
      userId: savedUser.id,
      language: data.language || 'vi',
      theme: 'dark',
    });
    await this.userSettingsRepository.save(userSettings);

    const { password, ...result } = savedUser;
    return result;
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

  async updateProfile(userId: number, updateData: { bio?: string; avatar?: string; gender?: string; dateOfBirth?: string; fullName?: string }) {
    try {
      console.log(`Updating profile for user ${userId}`, updateData);

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

      if (updateData.gender !== undefined) {
        user.gender = updateData.gender;
      }

      if (updateData.dateOfBirth !== undefined) {
        user.dateOfBirth = updateData.dateOfBirth ? new Date(updateData.dateOfBirth) : null;
      }

      if (updateData.fullName !== undefined) {
        user.fullName = updateData.fullName || null;
      }

      const updatedUser = await this.userRepository.save(user);
      console.log(`Profile updated for user ${userId}`);

      // ✅ Invalidate cache when user data changes
      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${updatedUser.username}`);
      console.log(`Cache invalidated for user ${userId}`);

      return {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        avatar: updatedUser.avatar,
        bio: updatedUser.bio,
        dateOfBirth: updatedUser.dateOfBirth,
        gender: updatedUser.gender,
      };
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  }

  // Get username change info (when user can change username next)
  async getUsernameChangeInfo(userId: number): Promise<{
    canChange: boolean;
    lastChangedAt: Date | null;
    nextChangeDate: Date | null;
    daysUntilChange: number;
  }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const COOLDOWN_DAYS = 30; // TikTok-style: can only change username every 30 days
      const lastChangedAt = user.usernameLastChangedAt;

      if (!lastChangedAt) {
        // Never changed username, can change now
        return {
          canChange: true,
          lastChangedAt: null,
          nextChangeDate: null,
          daysUntilChange: 0,
        };
      }

      const now = new Date();
      const nextChangeDate = new Date(lastChangedAt);
      nextChangeDate.setDate(nextChangeDate.getDate() + COOLDOWN_DAYS);

      const canChange = now >= nextChangeDate;
      const daysUntilChange = canChange ? 0 : Math.ceil((nextChangeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      return {
        canChange,
        lastChangedAt,
        nextChangeDate,
        daysUntilChange,
      };
    } catch (error) {
      console.error('Error getting username change info:', error);
      throw error;
    }
  }

  // Get display name change info (7-day cooldown like TikTok)
  async getDisplayNameChangeInfo(userId: number): Promise<{
    canChange: boolean;
    lastChangedAt: Date | null;
    nextChangeDate: Date | null;
    daysUntilChange: number;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const COOLDOWN_DAYS = 7;
    const lastChangedAt = user.displayNameLastChangedAt;

    if (!lastChangedAt) {
      return { canChange: true, lastChangedAt: null, nextChangeDate: null, daysUntilChange: 0 };
    }

    const now = new Date();
    const nextChangeDate = new Date(lastChangedAt);
    nextChangeDate.setDate(nextChangeDate.getDate() + COOLDOWN_DAYS);

    const canChange = now >= nextChangeDate;
    const daysUntilChange = canChange ? 0 : Math.ceil((nextChangeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return { canChange, lastChangedAt, nextChangeDate, daysUntilChange };
  }

  // Change display name (with validation and 7-day cooldown)
  async changeDisplayName(userId: number, newDisplayName: string): Promise<{
    success: boolean;
    message: string;
    user?: any;
    daysUntilChange?: number;
  }> {
    try {
      // Validate display name
      const trimmed = newDisplayName.trim();
      if (trimmed.length === 0) {
        return { success: false, message: 'DISPLAY_NAME_EMPTY' };
      }
      if (trimmed.length < 2) {
        return { success: false, message: 'DISPLAY_NAME_TOO_SHORT' };
      }
      if (trimmed.length > 30) {
        return { success: false, message: 'DISPLAY_NAME_TOO_LONG' };
      }
      // Allow letters (including Unicode), numbers, spaces, dots, underscores
      // Block special chars like < > " ' & ; etc.
      const displayNameRegex = /^[\p{L}\p{N}\s._\-]+$/u;
      if (!displayNameRegex.test(trimmed)) {
        return { success: false, message: 'DISPLAY_NAME_INVALID_CHARS' };
      }

      // Check for profanity/toxic content using AI
      const isToxic = await this.checkDisplayNameToxicity(trimmed);
      if (isToxic) {
        return { success: false, message: 'DISPLAY_NAME_INAPPROPRIATE' };
      }

      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Check if same as current
      if (user.fullName === trimmed) {
        return { success: false, message: 'DISPLAY_NAME_SAME' };
      }

      // Check cooldown (only if they've changed it before, not for first time setting)
      if (user.fullName && user.displayNameLastChangedAt) {
        const changeInfo = await this.getDisplayNameChangeInfo(userId);
        if (!changeInfo.canChange) {
          return {
            success: false,
            message: 'DISPLAY_NAME_COOLDOWN',
            daysUntilChange: changeInfo.daysUntilChange,
          };
        }
      }

      user.fullName = trimmed;
      user.displayNameLastChangedAt = new Date();
      const updatedUser = await this.userRepository.save(user);

      // Invalidate cache
      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${user.username}`);

      return {
        success: true,
        message: 'DISPLAY_NAME_CHANGED',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          fullName: updatedUser.fullName,
          displayNameLastChangedAt: updatedUser.displayNameLastChangedAt,
        },
      };
    } catch (error) {
      console.error('Error changing display name:', error);
      return { success: false, message: 'DISPLAY_NAME_ERROR' };
    }
  }

  // Remove display name (with 7-day cooldown - same as change)
  async removeDisplayName(userId: number): Promise<{
    success: boolean;
    message: string;
    daysUntilChange?: number;
  }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) return { success: false, message: 'User not found' };

      // No display name to remove
      if (!user.fullName) {
        return { success: false, message: 'DISPLAY_NAME_EMPTY' };
      }

      // Check cooldown (same 7-day window as changing)
      if (user.displayNameLastChangedAt) {
        const changeInfo = await this.getDisplayNameChangeInfo(userId);
        if (!changeInfo.canChange) {
          return {
            success: false,
            message: 'DISPLAY_NAME_COOLDOWN',
            daysUntilChange: changeInfo.daysUntilChange,
          };
        }
      }

      user.fullName = null;
      user.displayNameLastChangedAt = new Date();
      await this.userRepository.save(user);

      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${user.username}`);

      return { success: true, message: 'DISPLAY_NAME_REMOVED' };
    } catch (error) {
      console.error('Error removing display name:', error);
      return { success: false, message: 'DISPLAY_NAME_ERROR' };
    }
  }

  // Change username (with validation and cooldown)
  async changeUsername(userId: number, newUsername: string): Promise<{
    success: boolean;
    message: string;
    user?: any;
  }> {
    try {
      // Validate username format
      const usernameRegex = /^[a-zA-Z0-9_]{3,24}$/;
      if (!usernameRegex.test(newUsername)) {
        return {
          success: false,
          message: 'Username must be 3-24 characters and contain only letters, numbers, and underscores',
        };
      }

      // Check if username contains only numbers
      if (/^\d+$/.test(newUsername)) {
        return {
          success: false,
          message: 'Username cannot contain only numbers',
        };
      }

      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const oldUsername = user.username;

      // Check if username is the same
      if (oldUsername.toLowerCase() === newUsername.toLowerCase()) {
        return { success: false, message: 'New username must be different from current username' };
      }

      // Check cooldown
      const changeInfo = await this.getUsernameChangeInfo(userId);
      if (!changeInfo.canChange) {
        return {
          success: false,
          message: `You can change your username again in ${changeInfo.daysUntilChange} days`,
        };
      }

      // Check if new username is available
      const existingUser = await this.userRepository.findOne({
        where: { username: newUsername.toLowerCase() }
      });
      if (existingUser) {
        return { success: false, message: 'This username is already taken' };
      }

      // Update username
      user.username = newUsername.toLowerCase();
      user.usernameLastChangedAt = new Date();

      const updatedUser = await this.userRepository.save(user);

      // Invalidate cache for both old and new username
      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${oldUsername}`);
      await this.cacheManager.del(`user:username:${newUsername.toLowerCase()}`);

      console.log(`Username changed for user ${userId}: ${oldUsername} -> ${newUsername}`);

      return {
        success: true,
        message: 'Username changed successfully',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          avatar: updatedUser.avatar,
          usernameLastChangedAt: updatedUser.usernameLastChangedAt,
        },
      };
    } catch (error) {
      console.error('Error changing username:', error);
      return { success: false, message: 'Error changing username' };
    }
  }

  // Change password
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { success: false, message: 'Không tìm thấy người dùng' };
      }

      // Check if user has a password (OAuth users don't have password)
      if (!user.password) {
        return { success: false, message: 'Tài khoản này sử dụng đăng nhập mạng xã hội' };
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

      console.log(`Password changed for user ${userId}`);
      return { success: true, message: 'Đổi mật khẩu thành công' };
    } catch (error) {
      console.error('Error changing password:', error);
      return { success: false, message: 'Lỗi khi đổi mật khẩu' };
    }
  }

  // Check if user has password (for OAuth users)
  async hasPassword(userId: number): Promise<boolean> {
    try {
      console.log(`hasPassword service called for userId: ${userId}`);
      const user = await this.userRepository.findOne({ where: { id: userId } });

      if (!user) {
        console.log(`User not found for userId: ${userId}`);
        return false;
      }

      // Check for both null and empty string
      const result = user.password != null && user.password.trim() !== '';
      console.log(`User ${userId} password check: ${result ? 'HAS password' : 'NO password'}`);
      return result;
    } catch (error) {
      console.error(`Error in hasPassword for userId ${userId}:`, error);
      throw error;
    }
  }

  // Set password for OAuth users (who don't have password yet)
  async setPassword(userId: number, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { success: false, message: 'Không tìm thấy người dùng' };
      }

      // Check if user already has a password (not null and not empty)
      if (user.password && user.password.trim() !== '') {
        return { success: false, message: 'Tài khoản đã có mật khẩu. Vui lòng sử dụng chức năng đổi mật khẩu.' };
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

      console.log(`Password set for OAuth user ${userId}`);
      return { success: true, message: 'Đặt mật khẩu thành công' };
    } catch (error) {
      console.error('Error setting password:', error);
      return { success: false, message: 'Lỗi khi đặt mật khẩu' };
    }
  }

  // Store for OTP codes (in production, use Redis)
  private otpStore: Map<string, { code: string; expiresAt: Date }> = new Map();

  // Verify OTP only (without resetting password)
  async verifyOtp(email: string, otp: string): Promise<{ success: boolean; message: string }> {
    try {
      const storedOtp = this.otpStore.get(email);

      if (!storedOtp) {
        return { success: false, message: 'Mã xác nhận không hợp lệ hoặc đã hết hạn' };
      }

      if (new Date() > storedOtp.expiresAt) {
        this.otpStore.delete(email);
        return { success: false, message: 'Mã xác nhận đã hết hạn' };
      }

      if (storedOtp.code !== otp) {
        return { success: false, message: 'Mã xác nhận không đúng' };
      }

      return { success: true, message: 'Mã xác nhận hợp lệ' };
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return { success: false, message: 'Lỗi khi xác minh mã' };
    }
  }

  // Generate and store OTP for password reset
  async generatePasswordResetOtp(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { email } });
      if (!user) {
        // Return error if email doesn't exist
        return { success: false, message: 'Email này không tồn tại trong hệ thống' };
      }

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OTP
      this.otpStore.set(email, { code: otp, expiresAt });

      // Send OTP via email
      const emailSent = await this.emailService.sendOtpEmail(email, otp);

      if (!emailSent) {
        console.error('Failed to send OTP email');
        return { success: false, message: 'Không thể gửi email. Vui lòng thử lại sau.' };
      }

      console.log(`OTP for ${email}: ${otp}`); // Log for debugging

      return {
        success: true,
        message: 'Mã xác nhận đã được gửi đến email của bạn'
      };
    } catch (error) {
      console.error('Error generating OTP:', error);
      return { success: false, message: 'Lỗi khi tạo mã xác nhận' };
    }
  }

  // Verify OTP and reset password
  async verifyOtpAndResetPassword(email: string, otp: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      const storedOtp = this.otpStore.get(email);

      if (!storedOtp) {
        return { success: false, message: 'Mã xác nhận không hợp lệ hoặc đã hết hạn' };
      }

      if (new Date() > storedOtp.expiresAt) {
        this.otpStore.delete(email);
        return { success: false, message: 'Mã xác nhận đã hết hạn' };
      }

      if (storedOtp.code !== otp) {
        return { success: false, message: 'Mã xác nhận không đúng' };
      }

      // Find user and update password
      const user = await this.userRepository.findOne({ where: { email } });
      if (!user) {
        return { success: false, message: 'Không tìm thấy người dùng' };
      }

      // Hash new password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      user.password = hashedPassword;
      await this.userRepository.save(user);

      // Delete OTP after successful use
      this.otpStore.delete(email);

      // Invalidate cache
      await this.cacheManager.del(`user:id:${user.id}`);
      await this.cacheManager.del(`user:username:${user.username}`);

      console.log(`Password reset successful for ${email}`);
      return { success: true, message: 'Đặt lại mật khẩu thành công' };
    } catch (error) {
      console.error('Error resetting password:', error);
      return { success: false, message: 'Lỗi khi đặt lại mật khẩu' };
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
    console.log(`User ${blockerId} blocked user ${blockedId}`);
  }

  // Unblock a user
  async unblockUser(blockerId: number, blockedId: number): Promise<void> {
    await this.blockedUserRepository.delete({ blockerId, blockedId });
    console.log(`User ${blockerId} unblocked user ${blockedId}`);
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
    console.log(`Checking cache for user settings ${userId} with key: ${cacheKey}`);
    const cachedSettings = await this.cacheManager.get<UserSettings>(cacheKey);

    if (cachedSettings) {
      console.log(`Cache HIT for user settings ${userId}:`, cachedSettings);
      return cachedSettings;
    }

    console.log(`Cache MISS for user settings ${userId} - fetching from DB`);
    let settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });

    // If settings don't exist, create default settings
    if (!settings) {
      console.log(`Creating default settings for user ${userId}`);
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
      console.log(`Default settings created for user ${userId}:`, settings);
    } else {
      console.log(`Settings loaded from DB for user ${userId}:`, settings);
    }

    // Cache for 30 minutes
    await this.cacheManager.set(cacheKey, settings, 1800000);
    console.log(`Settings cached for user ${userId} with key: ${cacheKey}`);

    return settings;
  }

  // Update user settings
  async updateUserSettings(
    userId: number,
    updateData: UpdateUserSettingsDto,
  ): Promise<UserSettings> {
    console.log(`updateUserSettings called for userId ${userId} with data:`, JSON.stringify(updateData));
    
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
      console.log(`Creating new settings for user ${userId}`);
    } else {
      console.log(`Existing settings for user ${userId}:`, JSON.stringify(settings));
      // Update existing settings - only update fields that are provided
      if (updateData.theme !== undefined) settings.theme = updateData.theme;
      if (updateData.notificationsEnabled !== undefined) settings.notificationsEnabled = updateData.notificationsEnabled;
      if (updateData.pushNotifications !== undefined) settings.pushNotifications = updateData.pushNotifications;
      if (updateData.emailNotifications !== undefined) settings.emailNotifications = updateData.emailNotifications;
      if (updateData.loginAlertsEnabled !== undefined) settings.loginAlertsEnabled = updateData.loginAlertsEnabled;
      if (updateData.accountPrivacy !== undefined) settings.accountPrivacy = updateData.accountPrivacy;
      if (updateData.showOnlineStatus !== undefined) settings.showOnlineStatus = updateData.showOnlineStatus;
      if (updateData.autoplayVideos !== undefined) settings.autoplayVideos = updateData.autoplayVideos;
      if (updateData.videoQuality !== undefined) settings.videoQuality = updateData.videoQuality;
      if (updateData.language !== undefined) settings.language = updateData.language;
      if (updateData.timezone !== undefined) settings.timezone = updateData.timezone;
      if (updateData.whoCanViewVideos !== undefined) settings.whoCanViewVideos = updateData.whoCanViewVideos;
      if (updateData.whoCanSendMessages !== undefined) settings.whoCanSendMessages = updateData.whoCanSendMessages;
      if (updateData.whoCanComment !== undefined) settings.whoCanComment = updateData.whoCanComment;
      if (updateData.filterComments !== undefined) settings.filterComments = updateData.filterComments;
      
      // Follow approval toggle
      if (updateData.requireFollowApproval !== undefined) settings.requireFollowApproval = updateData.requireFollowApproval;

      // TikTok-style list privacy
      if (updateData.whoCanViewFollowingList !== undefined) settings.whoCanViewFollowingList = updateData.whoCanViewFollowingList;
      if (updateData.whoCanViewFollowersList !== undefined) settings.whoCanViewFollowersList = updateData.whoCanViewFollowersList;
      if (updateData.whoCanViewLikedVideos !== undefined) settings.whoCanViewLikedVideos = updateData.whoCanViewLikedVideos;

      // Push notification preferences (granular)
      if (updateData.pushLikes !== undefined) settings.pushLikes = updateData.pushLikes;
      if (updateData.pushComments !== undefined) settings.pushComments = updateData.pushComments;
      if (updateData.pushNewFollowers !== undefined) settings.pushNewFollowers = updateData.pushNewFollowers;
      if (updateData.pushMentions !== undefined) settings.pushMentions = updateData.pushMentions;
      if (updateData.pushMessages !== undefined) settings.pushMessages = updateData.pushMessages;
      if (updateData.pushProfileViews !== undefined) settings.pushProfileViews = updateData.pushProfileViews;

      // In-app notification preferences (granular)
      if (updateData.inAppLikes !== undefined) settings.inAppLikes = updateData.inAppLikes;
      if (updateData.inAppComments !== undefined) settings.inAppComments = updateData.inAppComments;
      if (updateData.inAppNewFollowers !== undefined) settings.inAppNewFollowers = updateData.inAppNewFollowers;
      if (updateData.inAppMentions !== undefined) settings.inAppMentions = updateData.inAppMentions;
      if (updateData.inAppMessages !== undefined) settings.inAppMessages = updateData.inAppMessages;
      if (updateData.inAppProfileViews !== undefined) settings.inAppProfileViews = updateData.inAppProfileViews;

      console.log(`Updated settings for user ${userId}:`, JSON.stringify(settings));
    }

    const updatedSettings = await this.userSettingsRepository.save(settings);

    // Invalidate cache
    await this.cacheManager.del(`user:settings:${userId}`);
    console.log(`Settings saved and cache invalidated for user ${userId}`);

    // Auto-approve all pending follow requests when user turns OFF requireFollowApproval
    if (updateData.requireFollowApproval === false) {
      try {
        const pendingRequests = await this.followRepository.find({
          where: { followingId: userId, status: 'pending' },
        });
        if (pendingRequests.length > 0) {
          for (const request of pendingRequests) {
            request.status = 'accepted';
          }
          await this.followRepository.save(pendingRequests);
          console.log(`Auto-approved ${pendingRequests.length} pending follow requests for user ${userId}`);
        }
      } catch (e) {
        console.error('Error auto-approving pending requests:', e);
      }
    }

    return updatedSettings;
  }

  // ============= ACCOUNT LINKING METHODS (TikTok-style) =============

  // Link email to existing account (for phone users) with password for email login
  async linkEmail(userId: number, email: string, hashedPassword?: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { success: false, message: 'Không tìm thấy người dùng' };
      }

      // Check if email already exists
      const existingEmail = await this.userRepository.findOne({ where: { email } });
      if (existingEmail && existingEmail.id !== userId) {
        return { success: false, message: 'Email này đã được sử dụng bởi tài khoản khác' };
      }

      // Check if user already has a real email (not placeholder)
      const isPlaceholderEmail = user.email?.endsWith('@phone.user');
      const hasRealEmail = user.email && !isPlaceholderEmail;

      // Update email
      user.email = email;

      // If password provided, set it so user can login with email+password
      if (hashedPassword) {
        user.password = hashedPassword;
      }

      await this.userRepository.save(user);

      // Invalidate cache
      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${user.username}`);

      console.log(`Email linked for user ${userId}: ${email}${hashedPassword ? ' (with password)' : ''}`);
      return {
        success: true,
        message: hasRealEmail ? 'Email đã được cập nhật' : 'Email đã được thêm vào tài khoản'
      };
    } catch (error) {
      console.error('Error linking email:', error);
      return { success: false, message: 'Lỗi khi liên kết email' };
    }
  }

  // Link phone to existing account (for email/Google users)
  async linkPhone(userId: number, phone: string, firebaseUid?: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { success: false, message: 'Không tìm thấy người dùng' };
      }

      // Check if phone already exists
      const existingPhone = await this.userRepository.findOne({ where: { phoneNumber: phone } });
      if (existingPhone && existingPhone.id !== userId) {
        return { success: false, message: 'Số điện thoại này đã được sử dụng bởi tài khoản khác' };
      }

      // Update phone
      user.phoneNumber = phone;
      if (firebaseUid) {
        user.providerId = firebaseUid;
      }
      await this.userRepository.save(user);

      // Invalidate cache
      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${user.username}`);

      console.log(`Phone linked for user ${userId}: ${phone}`);
      return { success: true, message: 'Số điện thoại đã được thêm vào tài khoản' };
    } catch (error) {
      console.error('Error linking phone:', error);
      return { success: false, message: 'Lỗi khi liên kết số điện thoại' };
    }
  }

  // Unlink phone from existing account
  async unlinkPhone(userId: number): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { success: false, message: 'Không tìm thấy người dùng' };
      }

      if (!user.phoneNumber) {
        return { success: false, message: 'Tài khoản chưa liên kết số điện thoại' };
      }

      // Remove phone
      user.phoneNumber = null;
      // Also clear Firebase providerId if auth was phone-based
      if (user.authProvider === 'phone') {
        user.providerId = null;
      }
      await this.userRepository.save(user);

      // Invalidate cache
      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${user.username}`);

      console.log(`Phone unlinked for user ${userId}`);
      return { success: true, message: 'Đã hủy liên kết số điện thoại' };
    } catch (error) {
      console.error('Error unlinking phone:', error);
      return { success: false, message: 'Lỗi khi hủy liên kết số điện thoại' };
    }
  }

  // Link Google account to existing user (TikTok-style: allows login via Google after linking email)
  async linkGoogleToExistingAccount(userId: number, googleProviderId: string): Promise<void> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return;
      }

      // Store Google provider ID so user can login with Google next time
      // We use a separate field or update providerId based on authProvider
      // For now, we'll just log it - the email match is enough for authentication
      console.log(`Google account linked for user ${userId}, providerId: ${googleProviderId}`);

      // Optional: Store googleProviderId for faster lookup next time
      // You could add a googleProviderId column to the user entity
      // For now, we rely on email matching

      // Invalidate cache
      await this.cacheManager.del(`user:id:${userId}`);
      await this.cacheManager.del(`user:username:${user.username}`);
    } catch (error) {
      console.error('Error linking Google to existing account:', error);
    }
  }

  // Get full account info with linked accounts
  async getAccountInfo(userId: number): Promise<any> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      return null;
    }

    // Check for legacy placeholder emails and treat as null
    const isPlaceholderEmail = user.email?.endsWith('@phone.user');
    const actualEmail = isPlaceholderEmail ? null : user.email;

    return {
      id: user.id,
      username: user.username,
      email: actualEmail,
      phoneNumber: user.phoneNumber,
      authProvider: user.authProvider,
      hasPassword: !!user.password,
      isVerified: user.isVerified,
      avatar: user.avatar,
      fullName: user.fullName,
      bio: user.bio,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      createdAt: user.createdAt,
      // 2FA info
      twoFactorEnabled: user.twoFactorEnabled || false,
      twoFactorMethods: user.twoFactorMethods || [],
    };
  }

  // Update 2FA settings
  async update2FASettings(userId: number, enabled: boolean, methods: string[]): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      user.twoFactorEnabled = enabled;
      user.twoFactorMethods = methods.length > 0 ? methods : null;
      await this.userRepository.save(user);

      // Invalidate cache
      await this.cacheManager.del(`user:id:${user.id}`);

      console.log(`2FA settings updated for user ${userId}: enabled=${enabled}, methods=${methods.join(',')}`);
      return { success: true, message: 'Cập nhật 2FA thành công' };
    } catch (error) {
      console.error('Error updating 2FA settings:', error);
      return { success: false, message: 'Lỗi khi cập nhật 2FA' };
    }
  }

  // Get 2FA settings
  async get2FASettings(userId: number): Promise<{ enabled: boolean; methods: string[] } | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return null;
    return {
      enabled: user.twoFactorEnabled || false,
      methods: user.twoFactorMethods || [],
    };
  }

  // Set TOTP secret for a user
  async setTotpSecret(userId: number, secret: string | null): Promise<boolean> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) return false;
      user.totpSecret = secret;
      await this.userRepository.save(user);
      await this.cacheManager.del(`user:id:${user.id}`);
      return true;
    } catch (error) {
      console.error('Error setting TOTP secret:', error);
      return false;
    }
  }

  // Get TOTP secret for a user
  async getTotpSecret(userId: number): Promise<string | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    return user?.totpSecret || null;
  }

  // Reset password by phone (for phone users)
  async resetPasswordByPhone(phone: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { phoneNumber: phone } });
      if (!user) {
        return { success: false, message: 'Số điện thoại không tồn tại trong hệ thống' };
      }

      // Hash new password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      user.password = hashedPassword;
      await this.userRepository.save(user);

      // Invalidate cache
      await this.cacheManager.del(`user:id:${user.id}`);
      await this.cacheManager.del(`user:username:${user.username}`);

      console.log(`Password reset via phone for user ${user.id}`);
      return { success: true, message: 'Đặt lại mật khẩu thành công' };
    } catch (error) {
      console.error('Error resetting password by phone:', error);
      return { success: false, message: 'Lỗi khi đặt lại mật khẩu' };
    }
  }

  // Check if phone number exists (for forgot password)
  async phoneExists(phone: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { phoneNumber: phone } });
    return !!user;
  }

  // Update user's lastSeen timestamp
  async updateLastSeen(userId: number): Promise<void> {
    try {
      await this.userRepository.update(userId, { lastSeen: new Date() });
      // Invalidate cache
      await this.cacheManager.del(`user:id:${userId}`);
    } catch (error) {
      console.error(`Error updating lastSeen for user ${userId}:`, error);
    }
  }

  // Get user's online status (privacy-aware)
  async getOnlineStatus(userId: number, requesterId?: number): Promise<{ isOnline: boolean; lastSeen: Date | null; statusText: string }> {
    try {
      // Check if user has disabled online status visibility
      if (requesterId && requesterId !== userId) {
        const settings = await this.userSettingsRepository.findOne({ where: { userId } });
        if (settings && !settings.showOnlineStatus) {
          return { isOnline: false, lastSeen: null, statusText: 'Offline' };
        }
      }

      const user = await this.userRepository.findOne({
        where: { id: userId },
        select: ['id', 'lastSeen'],
      });

      if (!user) {
        return { isOnline: false, lastSeen: null, statusText: 'Offline' };
      }

      const lastSeen = user.lastSeen;
      if (!lastSeen) {
        return { isOnline: false, lastSeen: null, statusText: 'Offline' };
      }

      const now = new Date();
      const diffMs = now.getTime() - new Date(lastSeen).getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      // Consider online if lastSeen within 2 minutes
      if (diffMinutes < 2) {
        return { isOnline: true, lastSeen, statusText: 'Online' };
      }

      // Generate human-readable status
      let statusText: string;
      if (diffMinutes < 60) {
        statusText = `${diffMinutes} phút trước`;
      } else if (diffMinutes < 1440) { // Less than 24 hours
        const hours = Math.floor(diffMinutes / 60);
        statusText = `${hours} giờ trước`;
      } else {
        const days = Math.floor(diffMinutes / 1440);
        statusText = `${days} ngày trước`;
      }

      return { isOnline: false, lastSeen, statusText };
    } catch (error) {
      console.error(`Error getting online status for user ${userId}:`, error);
      return { isOnline: false, lastSeen: null, statusText: 'Offline' };
    }
  }

  // ============= ACCOUNT DEACTIVATION =============

  async deactivateAccount(userId: number, password: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });

      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Verify password
      if (user.password) {
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
          return { success: false, message: 'Incorrect password' };
        }
      } else if (user.authProvider !== 'email') {
        // For OAuth users, we might want different verification
        // For now, allow deactivation without password for OAuth users
        // In production, you might want to verify via OAuth provider
      }

      // Deactivate the account
      user.isDeactivated = true;
      user.deactivatedAt = new Date();
      await this.userRepository.save(user);

      // Invalidate all active sessions (force logout everywhere)
      try {
        await this.sessionsService.logoutAllSessions(userId);
      } catch (err) {
        console.error(`Error invalidating sessions for user ${userId}:`, err);
      }

      // Clear any cached data for this user
      await this.cacheManager.del(`user:${userId}`);
      await this.cacheManager.del(`user:settings:${userId}`);

      console.log(`Account deactivated for user ${userId}`);

      return {
        success: true,
        message: 'Account has been deactivated. You can reactivate by logging in within 30 days.'
      };
    } catch (error) {
      console.error(`Error deactivating account for user ${userId}:`, error);
      return { success: false, message: 'Failed to deactivate account' };
    }
  }

  async reactivateAccount(body: { email?: string; username?: string; phone?: string; password: string }): Promise<{ success: boolean; message: string; user?: any }> {
    try {
      const { email, username, phone, password } = body;

      // Find user by email, username, or phone
      let user: User | null = null;
      if (email) {
        user = await this.userRepository.findOne({ where: { email } });
      } else if (username) {
        user = await this.userRepository.findOne({ where: { username } });
      } else if (phone) {
        user = await this.userRepository.findOne({ where: { phoneNumber: phone } });
      }

      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Check if account is actually deactivated
      if (!user.isDeactivated) {
        return { success: false, message: 'Account is not deactivated' };
      }

      // Check if within 30 days grace period
      if (user.deactivatedAt) {
        const daysSinceDeactivation = Math.floor(
          (Date.now() - new Date(user.deactivatedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceDeactivation > 30) {
          return { success: false, message: 'Account reactivation period has expired' };
        }
      }

      // Verify password
      if (user.password) {
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
          return { success: false, message: 'Incorrect password' };
        }
      }

      // Reactivate the account
      user.isDeactivated = false;
      user.deactivatedAt = null;
      await this.userRepository.save(user);

      console.log(`Account reactivated for user ${user.id}`);

      // Return user data for login
      const { password: _, ...userWithoutPassword } = user;

      return {
        success: true,
        message: 'Account has been reactivated',
        user: userWithoutPassword,
      };
    } catch (error) {
      console.error('Error reactivating account:', error);
      return { success: false, message: 'Failed to reactivate account' };
    }
  }

  async checkDeactivatedStatus(identifier: string): Promise<{ isDeactivated: boolean; deactivatedAt?: Date; daysRemaining?: number }> {
    try {
      // Try to find by email or username
      const user = await this.userRepository.findOne({
        where: [
          { email: identifier },
          { username: identifier },
        ],
        select: ['id', 'isDeactivated', 'deactivatedAt'],
      });

      if (!user) {
        return { isDeactivated: false };
      }

      if (!user.isDeactivated) {
        return { isDeactivated: false };
      }

      // Calculate days remaining for reactivation
      let daysRemaining = 30;
      if (user.deactivatedAt) {
        const daysSinceDeactivation = Math.floor(
          (Date.now() - new Date(user.deactivatedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        daysRemaining = Math.max(0, 30 - daysSinceDeactivation);
      }

      return {
        isDeactivated: true,
        deactivatedAt: user.deactivatedAt ?? undefined,
        daysRemaining,
      };
    } catch (error) {
      console.error('Error checking deactivated status:', error);
      return { isDeactivated: false };
    }
  }

  // ============= PRIVACY SETTINGS =============

  // Get privacy settings for a user (called by video-service)
  async getPrivacySettings(userId: number): Promise<{
    accountPrivacy: string;
    whoCanViewVideos: string;
    whoCanSendMessages: string;
    whoCanComment: string;
    filterComments: boolean;
    showOnlineStatus: boolean;
  }> {
    const settings = await this.userSettingsRepository.findOne({
      where: { userId },
      select: ['accountPrivacy', 'whoCanViewVideos', 'whoCanSendMessages', 'whoCanComment', 'filterComments', 'showOnlineStatus'],
    });

    return {
      accountPrivacy: settings?.accountPrivacy ?? 'public',
      whoCanViewVideos: settings?.whoCanViewVideos ?? 'everyone',
      whoCanSendMessages: settings?.whoCanSendMessages ?? 'everyone',
      whoCanComment: settings?.whoCanComment ?? 'everyone',
      filterComments: settings?.filterComments ?? true,
      showOnlineStatus: settings?.showOnlineStatus ?? true,
    };
  }

  // Check if requester has permission to perform action on target user
  async checkPrivacyPermission(
    requesterId: number,
    targetUserId: number,
    action: 'view_video' | 'send_message' | 'comment',
  ): Promise<{ allowed: boolean; reason?: string; isPrivateAccount?: boolean; isDeactivated?: boolean }> {
    // Owner always has permission
    if (requesterId === targetUserId) {
      return { allowed: true };
    }

    // Check if either user has blocked the other
    const [requesterBlockedTarget, targetBlockedRequester] = await Promise.all([
      this.isUserBlocked(requesterId, targetUserId),
      this.isUserBlocked(targetUserId, requesterId),
    ]);
    if (requesterBlockedTarget || targetBlockedRequester) {
      return {
        allowed: false,
        reason: targetBlockedRequester 
          ? 'Người dùng này đã chặn bạn'
          : 'Bạn đã chặn người dùng này',
      };
    }

    // Check if target user is deactivated
    const targetUser = await this.userRepository.findOne({
      where: { id: targetUserId },
      select: ['id', 'isDeactivated'],
    });
    if (targetUser?.isDeactivated) {
      return {
        allowed: false,
        reason: 'Tài khoản này đã bị vô hiệu hóa',
        isDeactivated: true,
      };
    }

    const settings = await this.getPrivacySettings(targetUserId);
    
    // Check if requester follows the target user
    const isFollower = await this.followRepository.findOne({
      where: { followerId: requesterId, followingId: targetUserId },
    }).then(f => !!f);

    // Check if they are friends (mutual follow)
    const isFriend = isFollower
      ? await this.followRepository.findOne({
          where: { followerId: targetUserId, followingId: requesterId },
        }).then(f => !!f)
      : false;

    // ============= ACCOUNT PRIVACY CHECK =============
    // If account is private, only followers can interact
    if (settings.accountPrivacy === 'private' && !isFollower) {
      return {
        allowed: false,
        reason: 'Tài khoản riêng tư',
        isPrivateAccount: true,
      };
    }

    let settingValue: string;
    switch (action) {
      case 'view_video':
        settingValue = settings.whoCanViewVideos;
        break;
      case 'send_message':
        settingValue = settings.whoCanSendMessages;
        break;
      case 'comment':
        settingValue = settings.whoCanComment;
        break;
      default:
        return { allowed: true };
    }

    switch (settingValue) {
      case 'everyone':
        return { allowed: true };
      case 'friends':
        if (isFriend) {
          return { allowed: true };
        }
        return { 
          allowed: false, 
          reason: action === 'view_video' 
            ? 'Chỉ bạn bè mới có thể xem video này'
            : action === 'send_message'
            ? 'Chỉ bạn bè mới có thể gửi tin nhắn'
            : 'Chỉ bạn bè mới có thể bình luận',
        };
      case 'noOne':
      case 'onlyMe':
        return { 
          allowed: false, 
          reason: action === 'view_video' 
            ? 'Video này ở chế độ riêng tư'
            : action === 'send_message'
            ? 'Hiện không thể nhắn tin với người này ngay lập tức'
            : 'Người dùng đã tắt bình luận',
        };
      default:
        return { allowed: true };
    }
  }

  // Get privacy settings for multiple users (batch)
  async getPrivacySettingsBatch(userIds: number[]): Promise<Map<number, {
    accountPrivacy: string;
    whoCanViewVideos: string;
    whoCanSendMessages: string;
    whoCanComment: string;
    filterComments: boolean;
  }>> {
    const result = new Map();
    if (!userIds || userIds.length === 0) return result;

    const uniqueIds = [...new Set(userIds)];
    const settings = await this.userSettingsRepository.find({
      where: uniqueIds.map(id => ({ userId: id })),
      select: ['userId', 'accountPrivacy', 'whoCanViewVideos', 'whoCanSendMessages', 'whoCanComment', 'filterComments'],
    });

    for (const s of settings) {
      result.set(s.userId, {
        accountPrivacy: s.accountPrivacy ?? 'public',
        whoCanViewVideos: s.whoCanViewVideos ?? 'everyone',
        whoCanSendMessages: s.whoCanSendMessages ?? 'everyone',
        whoCanComment: s.whoCanComment ?? 'everyone',
        filterComments: s.filterComments ?? true,
      });
    }

    // Fill defaults for users without settings
    for (const id of uniqueIds) {
      if (!result.has(id)) {
        result.set(id, {
          accountPrivacy: 'public',
          whoCanViewVideos: 'everyone',
          whoCanSendMessages: 'everyone',
          whoCanComment: 'everyone',
          filterComments: true,
        });
      }
    }

    return result;
  }

  // Get deactivation status for multiple users (batch) - used by video-service  
  async getDeactivatedUserIds(userIds: number[]): Promise<number[]> {
    if (!userIds || userIds.length === 0) return [];
    
    const uniqueIds = [...new Set(userIds)];
    const users = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id'])
      .where('user.id IN (:...ids)', { ids: uniqueIds })
      .andWhere('user.isDeactivated = :deactivated', { deactivated: true })
      .getMany();
    
    return users.map(u => u.id);
  }

  /**
   * Check if a display name contains toxic/inappropriate content using Gemini AI
   * Falls back to a simple bad words list if AI is unavailable
   */
  private async checkDisplayNameToxicity(name: string): Promise<boolean> {
    if (!name || name.trim().length < 2) return false;

    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      return this.containsBadWords(name);
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are a username/display name moderation classifier. Analyze the following display name and determine if it is inappropriate.

Inappropriate names include: profanity, vulgar language, slurs, insults, hate speech, sexual content, threats, or offensive references in ANY language (Vietnamese, English, or others).

Do NOT flag: normal names, nicknames, creative spellings, or casual/fun names that are not offensive.

Display name: "${name}"

Respond with ONLY one word: "TOXIC" or "SAFE". Nothing else.`,
              }],
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 10,
            },
          }),
        },
      );

      if (!response.ok) {
        return this.containsBadWords(name);
      }

      const data = await response.json();
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.toUpperCase();
      return result === 'TOXIC';
    } catch (error) {
      console.error('Display name toxicity check error:', error);
      return this.containsBadWords(name);
    }
  }

  /**
   * Simple bad words check (fallback when AI is unavailable)
   */
  private containsBadWords(content: string): boolean {
    const lower = content.toLowerCase();
    const badWords = [
      'đm', 'dcm', 'dm', 'đéo', 'địt', 'lồn', 'cặc', 'buồi', 'cc', 'cl', 'đĩ',
      'đụ', 'vkl', 'vãi', 'khốn', 'súc vật', 'con mẹ',
      'fuck', 'shit', 'bitch', 'dick', 'pussy', 'bastard', 'retard',
    ];
    return badWords.some(word => lower.includes(word));
  }
}

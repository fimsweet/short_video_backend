import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { UserSession, DevicePlatform } from '../entities/user-session.entity';
import { FcmService } from '../fcm/fcm.service';

export interface CreateSessionDto {
  userId: number;
  token: string;
  platform?: DevicePlatform;
  deviceName?: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  ipAddress?: string;
  location?: string;
  fcmToken?: string;
}

export interface SessionInfo {
  id: number;
  platform: DevicePlatform;
  deviceName: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  appVersion: string | null;
  ipAddress: string | null;
  location: string | null;
  loginAt: Date;
  lastActivityAt: Date | null;
  isCurrent: boolean;
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(UserSession)
    private sessionRepository: Repository<UserSession>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private fcmService: FcmService,
  ) {}

  /**
   * Create a new session when user logs in
   * Also sends login alert to other devices if enabled
   */
  async createSession(dto: CreateSessionDto): Promise<UserSession> {
    // Hash token for security (store only first/last 10 chars for identification)
    const tokenHash = this.hashToken(dto.token);

    const session = this.sessionRepository.create({
      userId: dto.userId,
      token: tokenHash,
      platform: dto.platform || 'unknown',
      deviceName: dto.deviceName,
      deviceModel: dto.deviceModel,
      fcmToken: dto.fcmToken,
      osVersion: dto.osVersion,
      appVersion: dto.appVersion,
      ipAddress: dto.ipAddress,
      location: dto.location,
      isActive: true,
      isCurrent: false,
      lastActivityAt: new Date(),
    });

    const savedSession = await this.sessionRepository.save(session);

    // Clear cache
    await this.cacheManager.del(`user_sessions:${dto.userId}`);

    // Send login alert to other devices (async, don't wait)
    this.sendLoginAlertToOtherDevices(
      dto.userId,
      savedSession.id,
      dto.deviceName || dto.platform || 'Unknown device',
      dto.platform || 'unknown',
      dto.location || '',
      dto.ipAddress || '',
    ).catch(err => console.error('Failed to send login alert:', err));

    return savedSession;
  }

  /**
   * Send login alert notification to all other active sessions with FCM tokens
   */
  private async sendLoginAlertToOtherDevices(
    userId: number,
    currentSessionId: number,
    deviceName: string,
    platform: string,
    location: string,
    ipAddress: string,
  ): Promise<void> {
    // Get all other active sessions with FCM tokens and login alerts enabled
    const otherSessions = await this.sessionRepository.find({
      where: {
        userId,
        isActive: true,
        loginAlertsEnabled: true,
      },
      select: ['id', 'fcmToken'],
    });

    // Filter out current session and sessions without FCM tokens
    const fcmTokens = otherSessions
      .filter(s => s.id !== currentSessionId && s.fcmToken)
      .map(s => s.fcmToken!);

    if (fcmTokens.length === 0) {
      return;
    }

    // Send login alert
    const result = await this.fcmService.sendLoginAlert(
      fcmTokens,
      deviceName,
      platform,
      location,
      ipAddress,
    );

    // Remove invalid FCM tokens
    if (result.failedTokens.length > 0) {
      await this.sessionRepository
        .createQueryBuilder()
        .update(UserSession)
        .set({ fcmToken: null })
        .where('fcmToken IN (:...tokens)', { tokens: result.failedTokens })
        .execute();
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: number, currentToken?: string): Promise<SessionInfo[]> {
    // Try cache first
    const cacheKey = `user_sessions:${userId}`;
    const cached = await this.cacheManager.get<SessionInfo[]>(cacheKey);
    
    if (cached) {
      // Mark current session
      if (currentToken) {
        const currentHash = this.hashToken(currentToken);
        return cached.map(s => ({
          ...s,
          isCurrent: s.id === this.findSessionIdByToken(cached, currentHash),
        }));
      }
      return cached;
    }

    const sessions = await this.sessionRepository.find({
      where: { userId, isActive: true },
      order: { loginAt: 'DESC' },
    });

    const currentHash = currentToken ? this.hashToken(currentToken) : null;

    const result: SessionInfo[] = sessions.map(session => ({
      id: session.id,
      platform: session.platform,
      deviceName: session.deviceName,
      deviceModel: session.deviceModel,
      osVersion: session.osVersion,
      appVersion: session.appVersion,
      ipAddress: session.ipAddress,
      location: session.location,
      loginAt: session.loginAt,
      lastActivityAt: session.lastActivityAt,
      isCurrent: currentHash ? session.token === currentHash : false,
    }));

    // Cache for 5 minutes
    await this.cacheManager.set(cacheKey, result, 300000);

    return result;
  }

  /**
   * Update last activity time for a session
   */
  async updateSessionActivity(userId: number, token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    
    await this.sessionRepository.update(
      { userId, token: tokenHash, isActive: true },
      { lastActivityAt: new Date() }
    );
  }

  /**
   * Logout from a specific session
   */
  async logoutSession(userId: number, sessionId: number): Promise<{ success: boolean; message: string }> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, userId, isActive: true },
    });

    if (!session) {
      return { success: false, message: 'Phiên đăng nhập không tồn tại' };
    }

    session.isActive = false;
    session.logoutAt = new Date();
    await this.sessionRepository.save(session);

    // Invalidate token in cache (blacklist)
    await this.cacheManager.set(`token_blacklist:${session.token}`, true, 86400000); // 24h

    // Clear user sessions cache
    await this.cacheManager.del(`user_sessions:${userId}`);

    return { success: true, message: 'Đã đăng xuất thiết bị thành công' };
  }

  /**
   * Logout from all sessions except current
   */
  async logoutAllOtherSessions(userId: number, currentToken: string): Promise<{ success: boolean; count: number }> {
    const currentHash = this.hashToken(currentToken);

    // Get all active sessions except current
    const sessions = await this.sessionRepository.find({
      where: { userId, isActive: true, token: Not(currentHash) },
    });

    // Blacklist all tokens
    for (const session of sessions) {
      await this.cacheManager.set(`token_blacklist:${session.token}`, true, 86400000);
    }

    // Mark all as inactive
    await this.sessionRepository.update(
      { userId, isActive: true, token: Not(currentHash) },
      { isActive: false, logoutAt: new Date() }
    );

    // Clear cache
    await this.cacheManager.del(`user_sessions:${userId}`);

    return { success: true, count: sessions.length };
  }

  /**
   * Logout from all sessions (including current)
   */
  async logoutAllSessions(userId: number): Promise<{ success: boolean; count: number }> {
    const sessions = await this.sessionRepository.find({
      where: { userId, isActive: true },
    });

    // Blacklist all tokens
    for (const session of sessions) {
      await this.cacheManager.set(`token_blacklist:${session.token}`, true, 86400000);
    }

    // Mark all as inactive
    await this.sessionRepository.update(
      { userId, isActive: true },
      { isActive: false, logoutAt: new Date() }
    );

    // Clear cache
    await this.cacheManager.del(`user_sessions:${userId}`);

    return { success: true, count: sessions.length };
  }

  /**
   * Check if a token is blacklisted
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const tokenHash = this.hashToken(token);
    const blacklisted = await this.cacheManager.get(`token_blacklist:${tokenHash}`);
    return !!blacklisted;
  }

  /**
   * Clean up old inactive sessions (can be called by cron)
   */
  async cleanupOldSessions(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.sessionRepository
      .createQueryBuilder()
      .delete()
      .where('isActive = :isActive', { isActive: false })
      .andWhere('logoutAt < :cutoffDate', { cutoffDate })
      .execute();

    return result.affected || 0;
  }

  /**
   * Get platform icon name based on platform
   */
  static getPlatformIcon(platform: DevicePlatform): string {
    const icons: Record<DevicePlatform, string> = {
      android: 'phone_android',
      ios: 'phone_iphone',
      web: 'computer',
      windows: 'desktop_windows',
      macos: 'desktop_mac',
      linux: 'computer',
      unknown: 'devices',
    };
    return icons[platform] || 'devices';
  }

  /**
   * Update FCM token for a session
   */
  async updateFcmToken(userId: number, token: string, fcmToken: string): Promise<{ success: boolean }> {
    const tokenHash = this.hashToken(token);
    
    const result = await this.sessionRepository.update(
      { userId, token: tokenHash, isActive: true },
      { fcmToken }
    );

    return { success: result.affected ? result.affected > 0 : false };
  }

  /**
   * Toggle login alerts for a session
   */
  async toggleLoginAlerts(userId: number, token: string, enabled: boolean): Promise<{ success: boolean }> {
    const tokenHash = this.hashToken(token);
    
    const result = await this.sessionRepository.update(
      { userId, token: tokenHash, isActive: true },
      { loginAlertsEnabled: enabled }
    );

    // Clear cache
    await this.cacheManager.del(`user_sessions:${userId}`);

    return { success: result.affected ? result.affected > 0 : false };
  }

  /**
   * Get login alerts status for current session
   */
  async getLoginAlertsStatus(userId: number, token: string): Promise<{ enabled: boolean; hasFcmToken: boolean }> {
    const tokenHash = this.hashToken(token);
    
    const session = await this.sessionRepository.findOne({
      where: { userId, token: tokenHash, isActive: true },
      select: ['loginAlertsEnabled', 'fcmToken'],
    });

    return {
      enabled: session?.loginAlertsEnabled ?? true,
      hasFcmToken: !!session?.fcmToken,
    };
  }

  /**
   * Hash token for storage (only store identifiable part)
   */
  private hashToken(token: string): string {
    // Store first 10 + last 10 chars for identification
    if (token.length <= 20) return token;
    return `${token.substring(0, 10)}...${token.substring(token.length - 10)}`;
  }

  private findSessionIdByToken(sessions: SessionInfo[], tokenHash: string): number | null {
    // This is a helper, in real implementation we'd need full token comparison
    return null;
  }
}

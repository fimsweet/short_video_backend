import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { UserSession, DevicePlatform } from '../entities/user-session.entity';
import { FcmService } from '../fcm/fcm.service';
import * as crypto from 'crypto';

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
   * Reuses existing session for same platform if exists
   * Also sends login alert to other devices if enabled
   */
  async createSession(dto: CreateSessionDto): Promise<UserSession> {
    // Hash token for security (store only first/last 10 chars for identification)
    const tokenHash = this.hashToken(dto.token);

    // Check if there's an existing active session for the same platform
    const existingSession = await this.sessionRepository.findOne({
      where: {
        userId: dto.userId,
        platform: dto.platform || 'unknown',
        isActive: true,
      },
      order: { lastActivityAt: 'DESC' },
    });

    // If existing session found, update it instead of creating new one
    if (existingSession) {
      existingSession.token = tokenHash;
      existingSession.fcmToken = dto.fcmToken || existingSession.fcmToken;
      existingSession.deviceName = dto.deviceName || existingSession.deviceName;
      existingSession.deviceModel = dto.deviceModel || existingSession.deviceModel;
      existingSession.osVersion = dto.osVersion || existingSession.osVersion;
      existingSession.appVersion = dto.appVersion || existingSession.appVersion;
      existingSession.lastActivityAt = new Date();
      
      const updatedSession = await this.sessionRepository.save(existingSession);
      
      // Clear cache
      await this.cacheManager.del(`user_sessions:${dto.userId}`);
      
      return updatedSession;
    }

    // Create new session only if no existing session for this platform
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
    session.fcmToken = null;
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

    // Mark all as inactive and clear FCM tokens
    await this.sessionRepository.update(
      { userId, isActive: true, token: Not(currentHash) },
      { isActive: false, logoutAt: new Date(), fcmToken: null as any }
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

    // Mark all as inactive and clear FCM tokens
    await this.sessionRepository.update(
      { userId, isActive: true },
      { isActive: false, logoutAt: new Date(), fcmToken: null as any }
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
   * Clear FCM token from the current session (used on logout)
   */
  async clearFcmToken(userId: number, token: string): Promise<{ success: boolean }> {
    const tokenHash = this.hashToken(token);
    
    // Clear FCM token from session matching this JWT
    const result = await this.sessionRepository.update(
      { userId, token: tokenHash, isActive: true },
      { fcmToken: null as any },
    );

    if (result.affected && result.affected > 0) {
      console.log(`[SESSION] FCM token cleared for userId=${userId}`);
      return { success: true };
    }

    // Fallback: clear from most recent active session
    const latestSession = await this.sessionRepository.findOne({
      where: { userId, isActive: true },
      order: { lastActivityAt: 'DESC' },
    });

    if (latestSession && latestSession.fcmToken) {
      latestSession.fcmToken = null;
      await this.sessionRepository.save(latestSession);
      console.log(`[SESSION] FCM token cleared via fallback for userId=${userId}`);
      return { success: true };
    }

    return { success: true };
  }

  /**
   * Update FCM token for a session
   * First deduplicates the token (removes from ALL other sessions), then assigns it
   */
  async updateFcmToken(userId: number, token: string, fcmToken: string): Promise<{ success: boolean }> {
    const tokenHash = this.hashToken(token);
    
    // CRITICAL: Remove this FCM token from ALL other sessions (any user)
    // This prevents the "wrong user gets push" bug when switching accounts on same device
    try {
      const deduped = await this.sessionRepository
        .createQueryBuilder()
        .update(UserSession)
        .set({ fcmToken: null as any })
        .where('fcmToken = :fcmToken', { fcmToken })
        .execute();
      if (deduped.affected && deduped.affected > 0) {
        console.log(`[SESSION] Deduplicated FCM token: cleared from ${deduped.affected} other session(s)`);
      }
    } catch (e) {
      console.error('[SESSION] Error deduplicating FCM token:', e);
    }
    
    // Try exact match first (session created with same JWT)
    const result = await this.sessionRepository.update(
      { userId, token: tokenHash, isActive: true },
      { fcmToken }
    );

    if (result.affected && result.affected > 0) {
      console.log(`[SESSION] FCM token updated for userId=${userId} (exact match, len=${fcmToken.length})`);
      console.log(`[SESSION] FCM token FULL: ${fcmToken}`);
      return { success: true };
    }

    // Fallback: update the most recent active session for this user
    // This handles cases where the session was created with a different token
    // (e.g., 2FA verify returns a new token, phone login, OAuth, etc.)
    const latestSession = await this.sessionRepository.findOne({
      where: { userId, isActive: true },
      order: { lastActivityAt: 'DESC' },
    });

    if (latestSession) {
      // Update both the FCM token and the token hash to match current JWT
      latestSession.fcmToken = fcmToken;
      latestSession.token = tokenHash;
      latestSession.lastActivityAt = new Date();
      await this.sessionRepository.save(latestSession);
      console.log(`[SESSION] FCM token updated via fallback for userId=${userId} (session ${latestSession.id}, len=${fcmToken.length})`);
      console.log(`[SESSION] FCM token FULL: ${fcmToken}`);
      return { success: true };
    }

    // No active session at all — create one
    const newSession = this.sessionRepository.create({
      userId,
      token: tokenHash,
      platform: 'unknown',
      fcmToken,
      isActive: true,
      lastActivityAt: new Date(),
    });
    await this.sessionRepository.save(newSession);
    console.log(`[SESSION] Created new session with FCM token for userId=${userId}`);
    
    return { success: true };
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
   * Hash token for storage using SHA-256
   */
  private hashToken(token: string): string {
    if (token.length <= 20) return token;
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 64);
  }

  private findSessionIdByToken(sessions: SessionInfo[], tokenHash: string): number | null {
    const match = sessions.find(s => (s as any)._tokenHash === tokenHash);
    return match ? match.id : null;
  }
}

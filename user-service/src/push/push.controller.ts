import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { FcmService } from '../fcm/fcm.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserSession } from '../entities/user-session.entity';
import { UserSettings } from '../entities/user-settings.entity';

interface SendPushDto {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Controller('push')
export class PushController {
  constructor(
    private readonly fcmService: FcmService,
    @InjectRepository(UserSession)
    private readonly sessionRepository: Repository<UserSession>,
    @InjectRepository(UserSettings)
    private readonly userSettingsRepository: Repository<UserSettings>,
  ) {}

  // ============================================
  // DIAGNOSTIC ENDPOINTS (for debugging FCM issues)
  // ============================================

  /**
   * Test FCM connectivity by sending a test notification to a specific user.
   * Usage: POST /push/test-fcm { "userId": "1" }
   * OR with a specific token: POST /push/test-fcm { "userId": "1", "fcmToken": "..." }
   */
  @Post('test-fcm')
  async testFcm(@Body() body: { userId?: string; fcmToken?: string }) {
    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      firebaseInitialized: false,
      tokensFound: 0,
      results: [],
    };

    try {
      // Check Firebase initialization
      const admin = require('firebase-admin');
      diagnostics.firebaseInitialized = admin.apps.length > 0;
      if (admin.apps.length > 0) {
        diagnostics.firebaseProject = admin.app().options.projectId || admin.app().options.credential?.projectId || 'unknown';
      }

      let tokens: string[] = [];

      if (body.fcmToken) {
        // Test with a specific token
        tokens = [body.fcmToken];
        diagnostics.tokenSource = 'manual';
      } else if (body.userId) {
        // Fetch tokens from DB
        const sessions = await this.sessionRepository.find({
          where: { userId: parseInt(body.userId), isActive: true },
          select: ['id', 'fcmToken', 'platform', 'lastActivityAt'],
        });
        
        diagnostics.activeSessions = sessions.map(s => ({
          id: s.id,
          hasFcmToken: !!s.fcmToken,
          tokenLength: s.fcmToken?.length || 0,
          tokenPreview: s.fcmToken ? `${s.fcmToken.substring(0, 30)}...${s.fcmToken.substring(s.fcmToken.length - 15)}` : null,
          platform: s.platform,
          lastActivity: s.lastActivityAt,
        }));
        
        tokens = sessions
          .map(s => s.fcmToken)
          .filter((t): t is string => !!t && t.length > 0);
        diagnostics.tokenSource = 'database';
      }

      diagnostics.tokensFound = tokens.length;

      if (tokens.length === 0) {
        diagnostics.error = 'No FCM tokens to test. Either provide fcmToken in body or ensure user has active sessions with tokens.';
        return diagnostics;
      }

      // Send test notification
      for (const token of tokens) {
        const testTitle = '🔔 FCM Test';
        const testBody = `Test push notification at ${new Date().toLocaleTimeString()}`;
        const testData = { type: 'fcm_test', timestamp: Date.now().toString() };

        console.log(`[FCM-TEST] Sending test push to token: ${token}`);
        console.log(`[FCM-TEST] Token length: ${token.length}`);
        console.log(`[FCM-TEST] Token full: ${token}`);

        try {
          const result = await this.fcmService.sendToDevices(
            [token],
            testTitle,
            testBody,
            testData,
          );

          diagnostics.results.push({
            tokenPreview: `${token.substring(0, 30)}...${token.substring(token.length - 15)}`,
            tokenLength: token.length,
            success: result.successCount > 0,
            successCount: result.successCount,
            failureCount: result.failureCount,
            errors: result.errors,
          });
        } catch (err: any) {
          diagnostics.results.push({
            tokenPreview: `${token.substring(0, 30)}...${token.substring(token.length - 15)}`,
            success: false,
            error: err.message,
          });
        }
      }
    } catch (error: any) {
      diagnostics.criticalError = error.message;
    }

    console.log('[FCM-TEST] Diagnostics result:', JSON.stringify(diagnostics, null, 2));
    return diagnostics;
  }

  /**
   * Get FCM debug info for a user — shows all sessions, tokens, and Firebase status
   * Usage: GET /push/debug/1
   */
  @Get('debug/:userId')
  async debugFcm(@Param('userId') userId: string) {
    try {
      const sessions = await this.sessionRepository.find({
        where: { userId: parseInt(userId), isActive: true },
        select: ['id', 'fcmToken', 'platform', 'deviceName', 'lastActivityAt', 'loginAt'],
      });

      const settings = await this.userSettingsRepository.findOne({
        where: { userId: parseInt(userId) },
      });

      const admin = require('firebase-admin');
      
      return {
        userId,
        firebase: {
          initialized: admin.apps.length > 0,
          projectId: admin.apps.length > 0 ? (admin.app().options.projectId || 'unknown') : 'not initialized',
        },
        pushSettings: {
          pushNotifications: settings?.pushNotifications ?? true,
          pushMessages: settings?.pushMessages ?? true,
          pushLikes: settings?.pushLikes ?? true,
          pushComments: settings?.pushComments ?? true,
          pushNewFollowers: settings?.pushNewFollowers ?? true,
        },
        sessions: sessions.map(s => ({
          id: s.id,
          platform: s.platform,
          deviceName: s.deviceName,
          hasFcmToken: !!s.fcmToken,
          fcmTokenLength: s.fcmToken?.length || 0,
          fcmTokenPreview: s.fcmToken ? `${s.fcmToken.substring(0, 40)}...${s.fcmToken.substring(s.fcmToken.length - 15)}` : null,
          lastActivity: s.lastActivityAt,
          loginAt: s.loginAt,
        })),
        totalSessions: sessions.length,
        sessionsWithToken: sessions.filter(s => !!s.fcmToken).length,
      };
    } catch (error: any) {
      return { error: error.message };
    }
  }

  /**
   * Check if a specific notification type is enabled for this user
   */
  private isNotificationTypeEnabled(
    settings: UserSettings | null,
    notificationType?: string,
  ): boolean {
    if (!settings) return true; // Default to enabled

    // Master push toggle
    if (!settings.pushNotifications) return false;

    // Check granular preferences based on notification type
    switch (notificationType) {
      case 'like':
        return settings.pushLikes ?? true;
      case 'comment':
      case 'reply':
        return settings.pushComments ?? true;
      case 'follow':
      case 'follow_request':
      case 'follow_request_accepted':
        return settings.pushNewFollowers ?? true;
      case 'mention':
        return settings.pushMentions ?? true;
      case 'message':
        return settings.pushMessages ?? true;
      case 'profile_view':
        return settings.pushProfileViews ?? true;
      case 'login_alert':
        return settings.loginAlertsEnabled ?? true;
      default:
        return true; // Unknown types default to enabled
    }
  }

  /**
   * Send push notification to a user (called by other services)
   */
  @Post('send')
  async sendPushNotification(@Body() dto: SendPushDto) {
    try {
      // Check if user has push notifications enabled
      const settings = await this.userSettingsRepository.findOne({
        where: { userId: parseInt(dto.userId) },
      });

      // Extract notification type from data
      const notificationType = dto.data?.type;

      // Check master toggle + granular preference
      if (!this.isNotificationTypeEnabled(settings, notificationType)) {
        return {
          success: false,
          message: `User has disabled ${notificationType || 'push'} notifications`,
        };
      }

      // Get all active sessions with FCM tokens
      const sessions = await this.sessionRepository.find({
        where: {
          userId: parseInt(dto.userId),
          isActive: true,
        },
        select: ['fcmToken'],
      });

      // Filter sessions with valid FCM tokens and deduplicate
      const fcmTokens = [...new Set(
        sessions
          .map((s) => s.fcmToken)
          .filter((token): token is string => !!token && token.length > 0)
      )];

      console.log(`[PUSH] Found ${sessions.length} active sessions, ${fcmTokens.length} FCM tokens for userId=${dto.userId}`);
      fcmTokens.forEach((token, i) => {
        console.log(`[PUSH] Token[${i}]: ${token.substring(0, 30)}...${token.substring(token.length - 15)} (len=${token.length})`);
        console.log(`[PUSH] Token[${i}] FULL: ${token}`);
      });

      if (fcmTokens.length === 0) {
        return {
          success: false,
          message: 'No active devices with push tokens',
        };
      }

      // Send push notification to all devices
      const result = await this.fcmService.sendToDevices(
        fcmTokens,
        dto.title,
        dto.body,
        dto.data || {},
      );

      // Clean up invalid FCM tokens (expired, unregistered, etc.)
      if (result.failedTokens.length > 0) {
        const invalidCodes = ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'];
        
        // Only clean tokens with permanent error codes, not transient failures
        for (let i = 0; i < result.errors.length; i++) {
          if (invalidCodes.includes(result.errors[i].code)) {
            const tokenToClean = result.failedTokens[i];
            if (tokenToClean) {
              try {
                await this.sessionRepository.update(
                  { fcmToken: tokenToClean },
                  { fcmToken: null as any },
                );
                console.log(`[PUSH] Cleaned up invalid FCM token: ${tokenToClean.substring(0, 20)}...`);
              } catch (e) {
                // Ignore cleanup errors
              }
            }
          }
        }
      }

      return {
        success: result.successCount > 0,
        sentTo: result.successCount,
        failed: result.failureCount,
        errors: result.errors,
      };
    } catch (error) {
      console.error('[ERROR] Error sending push notification:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if a specific in-app notification type is enabled for a user
   * Called by video-service before creating in-app notifications
   */
  @Get('preferences/:userId/:type')
  async checkNotificationPreference(
    @Param('userId') userId: string,
    @Param('type') type: string,
  ) {
    try {
      const settings = await this.userSettingsRepository.findOne({
        where: { userId: parseInt(userId) },
      });

      if (!settings) {
        return { enabled: true }; // Default enabled
      }

      let inAppEnabled = true;
      switch (type) {
        case 'like':
          inAppEnabled = settings.inAppLikes ?? true;
          break;
        case 'comment':
        case 'reply':
          inAppEnabled = settings.inAppComments ?? true;
          break;
        case 'follow':
        case 'follow_request':
        case 'follow_request_accepted':
          inAppEnabled = settings.inAppNewFollowers ?? true;
          break;
        case 'mention':
          inAppEnabled = settings.inAppMentions ?? true;
          break;
        case 'message':
          inAppEnabled = settings.inAppMessages ?? true;
          break;
        case 'profile_view':
          inAppEnabled = settings.inAppProfileViews ?? true;
          break;
        default:
          inAppEnabled = true;
      }

      return { enabled: inAppEnabled };
    } catch (error) {
      console.error('[ERROR] Error checking notification preference:', error);
      return { enabled: true }; // Default to enabled on error
    }
  }
}

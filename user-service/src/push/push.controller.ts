import { Controller, Post, Get, Body, Param } from '@nestjs/common';
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

      // Filter sessions with valid FCM tokens
      const fcmTokens = sessions
        .map((s) => s.fcmToken)
        .filter((token): token is string => !!token && token.length > 0);

      console.log(`[PUSH] Found ${sessions.length} active sessions, ${fcmTokens.length} FCM tokens for userId=${dto.userId}`);
      fcmTokens.forEach((token, i) => {
        console.log(`[PUSH] Token[${i}]: ${token.substring(0, 20)}...${token.substring(token.length - 10)}`);
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

      return {
        success: true,
        sentTo: result.successCount,
        failed: result.failureCount,
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

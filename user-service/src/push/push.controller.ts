import { Controller, Post, Body } from '@nestjs/common';
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
   * Send push notification to a user (called by other services)
   */
  @Post('send')
  async sendPushNotification(@Body() dto: SendPushDto) {
    try {
      // Check if user has push notifications enabled
      const settings = await this.userSettingsRepository.findOne({
        where: { userId: parseInt(dto.userId) },
      });

      // Default to enabled if no settings found - check pushNotifications setting
      const pushNotificationsEnabled = settings?.pushNotifications ?? true;
      
      if (!pushNotificationsEnabled) {
        return {
          success: false,
          message: 'User has disabled push notifications',
        };
      }

      // Get all active sessions with FCM tokens
      const sessions = await this.sessionRepository.find({
        where: {
          userId: parseInt(dto.userId),
          isActive: true,
          loginAlertsEnabled: true,
        },
        select: ['fcmToken'],
      });

      // Filter sessions with valid FCM tokens
      const fcmTokens = sessions
        .map((s) => s.fcmToken)
        .filter((token): token is string => !!token && token.length > 0);

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
      console.error('❌ Error sending push notification:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

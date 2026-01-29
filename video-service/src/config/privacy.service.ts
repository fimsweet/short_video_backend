import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PrivacyCheckResult {
  allowed: boolean;
  reason?: string;
}

interface PrivacySettings {
  accountPrivacy: string;
  whoCanViewVideos: string;
  whoCanSendMessages: string;
  whoCanComment: string;
  filterComments: boolean;
}

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);
  private readonly userServiceUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.userServiceUrl = this.configService.get<string>(
      'USER_SERVICE_URL',
      'http://localhost:3000',
    );
  }

  /**
   * Check if requester can perform action on target user's content
   */
  async checkPermission(
    requesterId: string,
    targetUserId: string,
    action: 'view_video' | 'send_message' | 'comment',
  ): Promise<PrivacyCheckResult> {
    // Same user always allowed
    if (requesterId === targetUserId) {
      return { allowed: true };
    }

    try {
      const response = await fetch(`${this.userServiceUrl}/users/privacy/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId,
          targetUserId,
          action,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Privacy check failed: ${response.status}`);
        return { allowed: true }; // Default to allowed on error
      }

      const result = await response.json();
      return {
        allowed: result.allowed ?? true,
        reason: result.reason,
      };
    } catch (error) {
      this.logger.error('Error checking privacy permission:', error);
      return { allowed: true }; // Default to allowed on error
    }
  }

  /**
   * Get privacy settings for a user
   */
  async getPrivacySettings(userId: string): Promise<PrivacySettings> {
    try {
      const response = await fetch(
        `${this.userServiceUrl}/users/privacy/${userId}`,
      );

      if (!response.ok) {
        this.logger.warn(`Failed to get privacy settings: ${response.status}`);
        return this.getDefaultSettings();
      }

      const result = await response.json();
      return result.settings ?? this.getDefaultSettings();
    } catch (error) {
      this.logger.error('Error getting privacy settings:', error);
      return this.getDefaultSettings();
    }
  }

  /**
   * Check if requester can view videos of target user
   */
  async canViewVideo(requesterId: string, videoOwnerId: string): Promise<PrivacyCheckResult> {
    return this.checkPermission(requesterId, videoOwnerId, 'view_video');
  }

  /**
   * Check if requester can send message to target user
   */
  async canSendMessage(requesterId: string, recipientId: string): Promise<PrivacyCheckResult> {
    return this.checkPermission(requesterId, recipientId, 'send_message');
  }

  /**
   * Check if requester can comment on target user's video
   */
  async canComment(requesterId: string, videoOwnerId: string): Promise<PrivacyCheckResult> {
    return this.checkPermission(requesterId, videoOwnerId, 'comment');
  }

  /**
   * Check if comment should be filtered (contains bad words)
   */
  async shouldFilterComment(videoOwnerId: string, content: string): Promise<boolean> {
    const settings = await this.getPrivacySettings(videoOwnerId);
    
    if (!settings.filterComments) {
      return false;
    }

    // Bad words filter (Vietnamese + English common bad words)
    const badWords = [
      // Vietnamese
      'đm', 'dcm', 'dm', 'đéo', 'địt', 'lồn', 'cặc', 'buồi', 'cc', 'cl', 'đĩ', 
      'đụ', 'vkl', 'vãi', 'ngu', 'đần', 'khốn', 'chó', 'súc vật', 'con mẹ',
      // English
      'fuck', 'shit', 'bitch', 'ass', 'damn', 'crap', 'dick', 'pussy',
      'bastard', 'idiot', 'stupid', 'dumb', 'retard',
    ];

    const lowerContent = content.toLowerCase();
    return badWords.some(word => lowerContent.includes(word));
  }

  private getDefaultSettings(): PrivacySettings {
    return {
      accountPrivacy: 'public',
      whoCanViewVideos: 'everyone',
      whoCanSendMessages: 'everyone',
      whoCanComment: 'everyone',
      filterComments: true,
    };
  }
}

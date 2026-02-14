import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PushNotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class PushNotificationService {
  private readonly userServiceUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.userServiceUrl = this.configService.get<string>(
      'USER_SERVICE_URL',
      'http://localhost:3000',
    );
  }

  /**
   * Send push notification to a user via user-service
   */
  async sendToUser(payload: PushNotificationPayload): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.userServiceUrl}/push/send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        console.error(`[ERROR] Failed to send push notification: ${response.status}`);
        return false;
      }

      const result = await response.json();
      return result.success ?? false;
    } catch (error) {
      console.error('[ERROR] Error sending push notification:', error);
      return false;
    }
  }

  /**
   * Check if a specific notification type is enabled for a user (in-app)
   */
  async isNotificationEnabled(userId: string, type: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.userServiceUrl}/push/preferences/${userId}/${type}`,
      );
      if (!response.ok) return true; // Default enabled on error
      const result = await response.json();
      return result.enabled ?? true;
    } catch (error) {
      console.error('[ERROR] Error checking notification preference:', error);
      return true; // Default enabled on error
    }
  }

  /**
   * Send notification for new message
   */
  async sendMessageNotification(
    recipientId: string,
    senderName: string,
    messagePreview: string,
    conversationId: string,
    senderId?: string,
  ): Promise<boolean> {
    return this.sendToUser({
      userId: recipientId,
      title: `💬 ${senderName}`,
      body: messagePreview.length > 50 
        ? messagePreview.substring(0, 50) + '...' 
        : messagePreview,
      data: {
        type: 'message',
        conversationId,
        senderId: senderId || senderName,
        senderName,
      },
    });
  }

  /**
   * Send notification for new follower
   */
  async sendFollowNotification(
    recipientId: string,
    followerName: string,
    followerAvatar?: string,
  ): Promise<boolean> {
    return this.sendToUser({
      userId: recipientId,
      title: '👤 Người theo dõi mới',
      body: `${followerName} đã bắt đầu theo dõi bạn`,
      data: {
        type: 'follow',
        followerName,
        followerAvatar: followerAvatar || '',
      },
    });
  }

  /**
   * Send notification for new like
   */
  async sendLikeNotification(
    recipientId: string,
    likerName: string,
    videoTitle?: string,
  ): Promise<boolean> {
    return this.sendToUser({
      userId: recipientId,
      title: '❤️ Lượt thích mới',
      body: `${likerName} đã thích video của bạn${videoTitle ? `: "${videoTitle}"` : ''}`,
      data: {
        type: 'like',
        likerName,
      },
    });
  }

  /**
   * Send notification for new comment
   */
  async sendCommentNotification(
    recipientId: string,
    commenterName: string,
    commentPreview: string,
    videoId: string,
  ): Promise<boolean> {
    return this.sendToUser({
      userId: recipientId,
      title: `💬 ${commenterName} đã bình luận`,
      body: commentPreview.length > 50 
        ? commentPreview.substring(0, 50) + '...' 
        : commentPreview,
      data: {
        type: 'comment',
        videoId,
        commenterName,
      },
    });
  }
}

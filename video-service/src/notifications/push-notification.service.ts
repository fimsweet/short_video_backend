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
   * Resolve userId → username by calling user-service
   */
  async getUsernameById(userId: string): Promise<string> {
    try {
      const response = await fetch(`${this.userServiceUrl}/users/id/${userId}`);
      if (response.ok) {
        const data = await response.json();
        return data?.username || 'Người dùng';
      }
    } catch (error) {
      console.error(`[PUSH] Failed to resolve username for userId=${userId}:`, error);
    }
    return 'Người dùng';
  }

  /**
   * Send push notification to a user via user-service
   */
  async sendToUser(payload: PushNotificationPayload): Promise<boolean> {
    try {
      console.log(`[PUSH] Sending to userId=${payload.userId}, type=${payload.data?.type || 'unknown'}, title="${payload.title}"`);
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
        const errorBody = await response.text().catch(() => 'no body');
        console.error(`[PUSH] Failed to send push notification: HTTP ${response.status} - ${errorBody}`);
        return false;
      }

      const result = await response.json();
      console.log(`[PUSH] Push result for userId=${payload.userId}: success=${result.success}, sentTo=${result.sentTo || 0}, failed=${result.failed || 0}`);
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
   * Sanitize message content for push notification display.
   * Converts [IMAGE:...], [STACKED_IMAGE:...], [VIDEO_SHARE:...] tags to friendly text.
   */
  private sanitizeMessagePreview(content: string, senderName: string): string {
    if (!content) return content;
    
    // System messages should not be pushed as regular messages
    if (content.startsWith('[THEME_CHANGE:')) {
      return `${senderName} đã đổi chủ đề cuộc trò chuyện 🎨`;
    }

    // Check for stacked images first (multiple images)
    if (content.includes('[STACKED_IMAGE:')) {
      const textPart = content.replace(/\n?\[STACKED_IMAGE:[^\]]+\]/g, '').trim();
      if (textPart) {
        return textPart;
      }
      return `${senderName} đã gửi nhiều ảnh 📷`;
    }
    
    // Check for single image
    if (content.includes('[IMAGE:')) {
      const textPart = content.replace(/\n?\[IMAGE:[^\]]+\]/g, '').trim();
      if (textPart) {
        return textPart;
      }
      return `${senderName} đã gửi một ảnh 📷`;
    }
    
    // Check for video share
    if (content.includes('[VIDEO_SHARE:')) {
      return `${senderName} đã chia sẻ một video 🎬`;
    }
    
    return content;
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
    const sanitized = this.sanitizeMessagePreview(messagePreview, senderName);
    return this.sendToUser({
      userId: recipientId,
      title: `💬 ${senderName}`,
      body: sanitized.length > 50 
        ? sanitized.substring(0, 50) + '...' 
        : sanitized,
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
   * Send notification for follow request
   */
  async sendFollowRequestNotification(
    recipientId: string,
    requesterName: string,
  ): Promise<boolean> {
    return this.sendToUser({
      userId: recipientId,
      title: '📩 Yêu cầu theo dõi',
      body: `${requesterName} đã gửi yêu cầu theo dõi bạn`,
      data: {
        type: 'follow_request',
        requesterName,
      },
    });
  }

  /**
   * Send notification for follow request accepted
   */
  async sendFollowRequestAcceptedNotification(
    recipientId: string,
    accepterName: string,
  ): Promise<boolean> {
    return this.sendToUser({
      userId: recipientId,
      title: '✅ Yêu cầu được chấp nhận',
      body: `${accepterName} đã chấp nhận yêu cầu theo dõi của bạn`,
      data: {
        type: 'follow_request_accepted',
        accepterName,
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

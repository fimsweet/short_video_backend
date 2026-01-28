import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from '../entities/notification.entity';
import { PushNotificationService } from './push-notification.service';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    private pushNotificationService: PushNotificationService,
  ) {}

  async createNotification(
    recipientId: string,
    senderId: string,
    type: NotificationType,
    videoId?: string,
    commentId?: string,
    message?: string,
    senderName?: string,
  ): Promise<Notification | null> {
    // Don't create notification if sender is the same as recipient
    if (recipientId === senderId) {
      return null;
    }

    const notification = this.notificationRepository.create({
      recipientId,
      senderId,
      type,
      videoId,
      commentId,
      message,
    });

    const saved = await this.notificationRepository.save(notification);

    // Send push notification based on type
    this.sendPushForNotification(
      recipientId,
      type,
      senderName || 'Người dùng',
      message,
      videoId,
    );

    return saved;
  }

  /**
   * Send push notification based on notification type
   */
  private async sendPushForNotification(
    recipientId: string,
    type: NotificationType,
    senderName: string,
    message?: string,
    videoId?: string,
  ): Promise<void> {
    try {
      switch (type) {
        case NotificationType.LIKE:
          await this.pushNotificationService.sendLikeNotification(
            recipientId,
            senderName,
          );
          break;
        case NotificationType.COMMENT:
          await this.pushNotificationService.sendCommentNotification(
            recipientId,
            senderName,
            message || 'Đã bình luận video của bạn',
            videoId || '',
          );
          break;
        case NotificationType.FOLLOW:
          await this.pushNotificationService.sendFollowNotification(
            recipientId,
            senderName,
          );
          break;
        case NotificationType.MENTION:
          await this.pushNotificationService.sendToUser({
            userId: recipientId,
            title: `📢 ${senderName} đã nhắc đến bạn`,
            body: message || 'trong một bình luận',
            data: { type: 'mention', videoId: videoId || '' },
          });
          break;
        case NotificationType.REPLY:
          await this.pushNotificationService.sendToUser({
            userId: recipientId,
            title: `💬 ${senderName} đã trả lời bạn`,
            body: message || 'Xem phản hồi ngay',
            data: { type: 'reply', videoId: videoId || '' },
          });
          break;
        default:
          // For other types, send generic notification
          if (message) {
            await this.pushNotificationService.sendToUser({
              userId: recipientId,
              title: 'Thông báo mới',
              body: message,
              data: { type: type.toString() },
            });
          }
      }
    } catch (error) {
      console.error('❌ Error sending push notification:', error);
    }
  }

  async getNotifications(userId: string, limit: number = 50): Promise<any[]> {
    const notifications = await this.notificationRepository.find({
      where: { recipientId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return notifications;
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository.count({
      where: { recipientId: userId, isRead: false },
    });
  }

  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const result = await this.notificationRepository.update(
      { id: notificationId, recipientId: userId },
      { isRead: true },
    );
    return (result.affected ?? 0) > 0;
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.update(
      { recipientId: userId, isRead: false },
      { isRead: true },
    );
  }

  async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    const result = await this.notificationRepository.delete({
      id: notificationId,
      recipientId: userId,
    });
    return (result.affected ?? 0) > 0;
  }
}

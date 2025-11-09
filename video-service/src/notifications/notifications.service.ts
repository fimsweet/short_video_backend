import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from '../entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
  ) {}

  async createNotification(
    recipientId: string,
    senderId: string,
    type: NotificationType,
    videoId?: string,
    commentId?: string,
    message?: string,
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

    return this.notificationRepository.save(notification);
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

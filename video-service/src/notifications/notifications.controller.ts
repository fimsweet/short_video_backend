import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '../entities/notification.entity';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('create')
  async createNotification(@Body() body: {
    recipientId: string;
    senderId: string;
    type: NotificationType;
    videoId?: string;
    commentId?: string;
    message?: string;
  }) {
    const notification = await this.notificationsService.createNotification(
      body.recipientId,
      body.senderId,
      body.type,
      body.videoId,
      body.commentId,
      body.message,
    );
    return { success: true, data: notification };
  }

  @Get(':userId')
  async getNotifications(@Param('userId') userId: string) {
    const notifications = await this.notificationsService.getNotifications(userId);
    return { success: true, data: notifications };
  }

  @Get('unread/:userId')
  async getUnreadCount(@Param('userId') userId: string) {
    console.log(`📊 Getting unread count for user ${userId}`);
    const count = await this.notificationsService.getUnreadCount(userId);
    console.log(`✅ Unread count: ${count}`);
    return { success: true, count };
  }

  @Post('read/:notificationId')
  async markAsRead(
    @Param('notificationId') notificationId: string,
    @Body('userId') userId: string,
  ) {
    const success = await this.notificationsService.markAsRead(notificationId, userId);
    return { success };
  }

  @Post('read-all/:userId')
  async markAllAsRead(@Param('userId') userId: string) {
    await this.notificationsService.markAllAsRead(userId);
    return { success: true };
  }

  @Delete(':notificationId')
  async deleteNotification(
    @Param('notificationId') notificationId: string,
    @Body('userId') userId: string,
  ) {
    const success = await this.notificationsService.deleteNotification(notificationId, userId);
    return { success };
  }
}

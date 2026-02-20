import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationService } from './push-notification.service';
import { Notification } from '../entities/notification.entity';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    forwardRef(() => MessagesModule),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushNotificationService],
  exports: [NotificationsService, PushNotificationService],
})
export class NotificationsModule {}

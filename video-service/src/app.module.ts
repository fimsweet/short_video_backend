import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VideosModule } from './videos/videos.module';
import { LikesModule } from './likes/likes.module';
import { CommentsModule } from './comments/comments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SavedVideosModule } from './saved-videos/saved-videos.module';
import { MessagesModule } from './messages/messages.module';
import { SharesModule } from './shares/shares.module';
import { getDatabaseConfig } from './config/database.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getDatabaseConfig,
      inject: [ConfigService],
    }),
    VideosModule,
    LikesModule,
    CommentsModule,
    NotificationsModule,
    SavedVideosModule,
    MessagesModule,
    SharesModule,
  ],
})
export class AppModule {}

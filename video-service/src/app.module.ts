import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisCacheModule } from './config/redis-cache.module';
import { HealthModule } from './health/health.module';
import { VideosModule } from './videos/videos.module';
import { LikesModule } from './likes/likes.module';
import { CommentsModule } from './comments/comments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SavedVideosModule } from './saved-videos/saved-videos.module';
import { MessagesModule } from './messages/messages.module';
import { SharesModule } from './shares/shares.module';
import { CategoriesModule } from './categories/categories.module';
import { RecommendationModule } from './recommendation/recommendation.module';
import { WatchHistoryModule } from './watch-history/watch-history.module';
import { SearchModule } from './search/search.module';
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
    RedisCacheModule, // Redis cache global
    HealthModule, // Health check endpoints
    VideosModule,
    LikesModule,
    CommentsModule,
    NotificationsModule,
    SavedVideosModule,
    MessagesModule,
    SharesModule,
    CategoriesModule, // ✅ Video categories
    RecommendationModule, // ✅ Video recommendations
    WatchHistoryModule, // ✅ Watch time tracking for recommendations
    SearchModule, // ✅ Elasticsearch search
  ],
})
export class AppModule {}

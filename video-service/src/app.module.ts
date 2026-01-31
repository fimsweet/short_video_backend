import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { RedisCacheModule } from './config/redis-cache.module';
import { StorageModule } from './config/storage.module';
import { ActivityLoggerModule } from './config/activity-logger.module';
import { PrivacyModule } from './config/privacy.module';
import { CleanupModule } from './common/cleanup.module';
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
import { AnalyticsModule } from './analytics/analytics.module';
import { getDatabaseConfig } from './config/database.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // ============================================
    // 🛡️ RATE LIMITING - Protect against DDoS
    // ============================================
    // Default: 100 requests per 60 seconds per IP
    // Upload endpoints have stricter limits (see VideosController)
    // ============================================
    ThrottlerModule.forRoot([{
      ttl: 60000, // 60 seconds window
      limit: 100, // Max 100 requests per window
    }]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getDatabaseConfig,
      inject: [ConfigService],
    }),
    RedisCacheModule, // Redis cache global
    StorageModule, // AWS S3 storage (global)
    ActivityLoggerModule, //  Activity logging (global)
    PrivacyModule, //  Privacy settings check (global)
    CleanupModule, //  Auto cleanup temp files (every 6h + 3AM daily)
    HealthModule, // Health check endpoints
    VideosModule,
    LikesModule,
    CommentsModule,
    NotificationsModule,
    SavedVideosModule,
    MessagesModule,
    SharesModule,
    CategoriesModule, //  Video categories
    RecommendationModule, //  Video recommendations
    WatchHistoryModule, //  Watch time tracking for recommendations
    SearchModule, //  Elasticsearch search
    AnalyticsModule, //  Creator analytics
  ],
  providers: [
    // ============================================
    //  Global Rate Limiting Guard
    // ============================================
    // Applied to ALL endpoints by default
    // Use @SkipThrottle() to bypass for specific endpoints
    // Use @Throttle({ default: { limit: 5, ttl: 60000 } }) for stricter limits
    // ============================================
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config'; // Thêm import này
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { databaseConfig } from './config/database.config';
import { FollowsModule } from './follows/follows.module';
import { RedisCacheModule } from './config/redis-cache.module';
import { HealthModule } from './health/health.module';
import { EmailModule } from './config/email.module';
import { UserInterestsModule } from './user-interests/user-interests.module';
import { ActivityHistoryModule } from './activity-history/activity-history.module';
import { SessionsModule } from './sessions/sessions.module';
import { PushModule } from './push/push.module';

@Module({
  imports: [
    ConfigModule.forRoot({ // Thêm cấu hình này
      isGlobal: true, // Giúp ConfigModule có sẵn ở mọi nơi
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot(databaseConfig),
    RedisCacheModule, // ✅ Redis cache global
    EmailModule, // ✅ Email service (Nodemailer)
    HealthModule, // ✅ Health check endpoints
    AuthModule,
    UsersModule,
    FollowsModule,
    UserInterestsModule, // ✅ User interests for recommendations
    ActivityHistoryModule, // ✅ Activity history tracking
    SessionsModule, // ✅ Device sessions management
    PushModule, // ✅ Push notifications endpoint
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

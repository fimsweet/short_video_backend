import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Video } from '../entities/video.entity';
import { VideoCategory } from '../entities/video-category.entity';
import { Category } from '../entities/category.entity';
import { Like } from '../entities/like.entity';
import { RecommendationService } from './recommendation.service';
import { RecommendationController } from './recommendation.controller';
import { LikesModule } from '../likes/likes.module';
import { CommentsModule } from '../comments/comments.module';
import { SavedVideosModule } from '../saved-videos/saved-videos.module';
import { SharesModule } from '../shares/shares.module';
import { CategoriesModule } from '../categories/categories.module';
import { WatchHistoryModule } from '../watch-history/watch-history.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, VideoCategory, Category, Like]),
    HttpModule,
    forwardRef(() => LikesModule),
    forwardRef(() => CommentsModule),
    forwardRef(() => SavedVideosModule),
    forwardRef(() => SharesModule),
    CategoriesModule,
    forwardRef(() => WatchHistoryModule),
  ],
  controllers: [RecommendationController],
  providers: [RecommendationService],
  exports: [RecommendationService],
})
export class RecommendationModule {}

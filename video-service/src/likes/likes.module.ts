import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';
import { Like } from '../entities/like.entity';
import { Video } from '../entities/video.entity';
import { CommentsModule } from '../comments/comments.module';
import { SavedVideosModule } from '../saved-videos/saved-videos.module';
import { SharesModule } from '../shares/shares.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Like, Video]),
    forwardRef(() => CommentsModule),
    forwardRef(() => SavedVideosModule),
    forwardRef(() => SharesModule),
  ],
  controllers: [LikesController],
  providers: [LikesService],
  exports: [LikesService],
})
export class LikesModule {}

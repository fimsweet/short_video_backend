import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Video } from '../entities/video.entity';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { ChunkedUploadService } from './chunked-upload.service';
import { LikesModule } from '../likes/likes.module';
import { CommentsModule } from '../comments/comments.module';
import { SavedVideosModule } from '../saved-videos/saved-videos.module';
import { SharesModule } from '../shares/shares.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    HttpModule,
    forwardRef(() => LikesModule),
    forwardRef(() => CommentsModule),
    forwardRef(() => SavedVideosModule),
    forwardRef(() => SharesModule),
  ],
  controllers: [VideosController],
  providers: [VideosService, ChunkedUploadService],
  exports: [VideosService],
})
export class VideosModule {}

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { Video } from '../entities/video.entity';
import { LikesModule } from '../likes/likes.module';
import { CommentsModule } from '../comments/comments.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    forwardRef(() => LikesModule),
    forwardRef(() => CommentsModule),
    HttpModule,
  ],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}

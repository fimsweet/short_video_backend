import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Video } from '../entities/video.entity';
import { Like } from '../entities/like.entity';
import { Comment } from '../entities/comment.entity';
import { Share } from '../entities/share.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([Video, Like, Comment, Share]),
        HttpModule,
    ],
    controllers: [AnalyticsController],
    providers: [AnalyticsService],
    exports: [AnalyticsService],
})
export class AnalyticsModule { }

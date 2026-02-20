import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Share } from '../entities/share.entity';
import { Video } from '../entities/video.entity';
import { SharesService } from './shares.service';
import { SharesController } from './shares.controller';
import { VideosModule } from '../videos/videos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Share, Video]),
    forwardRef(() => VideosModule),
  ],
  controllers: [SharesController],
  providers: [SharesService],
  exports: [SharesService],
})
export class SharesModule {}

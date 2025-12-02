import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedVideo } from '../entities/saved-video.entity';
import { SavedVideosService } from './saved-videos.service';
import { SavedVideosController } from './saved-videos.controller';
import { VideosModule } from '../videos/videos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SavedVideo]),
    forwardRef(() => VideosModule),
  ],
  controllers: [SavedVideosController],
  providers: [SavedVideosService],
  exports: [SavedVideosService],
})
export class SavedVideosModule {}

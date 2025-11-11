import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedVideosController } from './saved-videos.controller';
import { SavedVideosService } from './saved-videos.service';
import { SavedVideo } from '../entities/saved-video.entity';
import { VideosModule } from '../videos/videos.module'; // Add this import

@Module({
  imports: [
    TypeOrmModule.forFeature([SavedVideo]),
    forwardRef(() => VideosModule), // Add this to resolve circular dependency
  ],
  controllers: [SavedVideosController],
  providers: [SavedVideosService],
  exports: [SavedVideosService],
})
export class SavedVideosModule {}

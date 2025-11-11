import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedVideo } from '../entities/saved-video.entity';
import { VideosService } from '../videos/videos.service';

@Injectable()
export class SavedVideosService {
  constructor(
    @InjectRepository(SavedVideo)
    private savedVideoRepository: Repository<SavedVideo>,
    @Inject(forwardRef(() => VideosService))
    private videosService: VideosService,
  ) {}

  async toggleSave(videoId: string, userId: string): Promise<{ saved: boolean }> {
    const existing = await this.savedVideoRepository.findOne({
      where: { videoId, userId },
    });

    if (existing) {
      await this.savedVideoRepository.remove(existing);
      return { saved: false };
    } else {
      await this.savedVideoRepository.save({ videoId, userId });
      return { saved: true };
    }
  }

  async isSavedByUser(videoId: string, userId: string): Promise<boolean> {
    const saved = await this.savedVideoRepository.findOne({
      where: { videoId, userId },
    });
    return !!saved;
  }

  async getSavedVideos(userId: string): Promise<any[]> {
    console.log(`📹 Fetching saved videos for user ${userId}...`);
    
    const savedVideos = await this.savedVideoRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    console.log(`✅ Found ${savedVideos.length} saved video records`);

    // Get full video details with like/comment counts
    const videosWithDetails = await Promise.all(
      savedVideos.map(async (saved) => {
        const video = await this.videosService.getVideoById(saved.videoId);
        
        if (video) {
          console.log(`   Video ${video.id}:`);
          console.log(`     likeCount: ${video.likeCount}`);
          console.log(`     commentCount: ${video.commentCount}`);
          console.log(`     thumbnailUrl: ${video.thumbnailUrl}`);
          
          return video; // Return full video object with counts
        }
        
        return null;
      }),
    );

    // Filter out null values (deleted videos)
    const validVideos = videosWithDetails.filter(v => v !== null);
    console.log(`📤 Returning ${validVideos.length} saved videos with full details`);
    
    return validVideos;
  }
}

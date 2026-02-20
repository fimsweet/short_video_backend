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

  async toggleSave(videoId: string, userId: string): Promise<{ saved: boolean; saveCount: number }> {
    console.log(`[TOGGLE] Toggle save: videoId=${videoId}, userId=${userId}`);
    
    const existingSave = await this.savedVideoRepository.findOne({
      where: { videoId, userId },
    });

    if (existingSave) {
      console.log('Unsave - removing existing save');
      await this.savedVideoRepository.remove(existingSave);
      const saveCount = await this.getSaveCount(videoId);
      return { saved: false, saveCount };
    } else {
      console.log('Save - creating new save');
      await this.savedVideoRepository.save({
        videoId,
        userId,
      });
      const saveCount = await this.getSaveCount(videoId);
      return { saved: true, saveCount };
    }
  }

  async getSaveCount(videoId: string): Promise<number> {
    return this.savedVideoRepository.count({ where: { videoId } });
  }

  async isSavedByUser(videoId: string, userId: string): Promise<boolean> {
    const save = await this.savedVideoRepository.findOne({
      where: { videoId, userId },
    });
    return !!save;
  }

  async getSavedVideos(userId: string): Promise<any[]> {
    console.log(`[FETCH] Fetching saved videos for user ${userId}...`);
    
    const savedVideos = await this.savedVideoRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    console.log(`[OK] Found ${savedVideos.length} saved video records`);

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

    // Filter out null values (deleted videos) and hidden videos
    const validVideos = videosWithDetails.filter(v => v !== null && !v.isHidden);
    console.log(`[RETURN] Returning ${validVideos.length} saved videos with full details`);
    
    return validVideos;
  }

  async deleteAllSavesForVideo(videoId: string): Promise<void> {
    await this.savedVideoRepository.delete({ videoId });
    console.log(`[DELETE] Deleted all saves for video ${videoId}`);
  }
}

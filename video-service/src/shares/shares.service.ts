import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Share } from '../entities/share.entity';
import { Video } from '../entities/video.entity';

@Injectable()
export class SharesService {
  constructor(
    @InjectRepository(Share)
    private shareRepository: Repository<Share>,
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
  ) {}

  async createShare(videoId: string, sharerId: string, recipientId: string): Promise<{ shareCount: number }> {
    console.log(`[SHARE] Creating share: videoId=${videoId}, sharerId=${sharerId}, recipientId=${recipientId}`);
    
    // Block sharing of hidden or private videos for non-owners
    const video = await this.videoRepository.findOne({ where: { id: videoId } });
    if (video?.isHidden && video?.userId !== sharerId) {
      console.log(`[SHARE] Blocked: cannot share hidden video ${videoId}`);
      throw new Error('Cannot share a hidden video');
    }
    if (video?.visibility === 'private' && video?.userId !== sharerId) {
      console.log(`[SHARE] Blocked: cannot share private video ${videoId}`);
      throw new Error('Cannot share a private video');
    }

    // Create new share record
    await this.shareRepository.save({
      videoId,
      sharerId,
      recipientId,
    });

    const shareCount = await this.getShareCount(videoId);
    console.log(`[OK] Share created, total count: ${shareCount}`);
    
    return { shareCount };
  }

  async getShareCount(videoId: string): Promise<number> {
    return this.shareRepository.count({ where: { videoId } });
  }

  async getSharesByVideo(videoId: string): Promise<Share[]> {
    return this.shareRepository.find({
      where: { videoId },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteAllSharesForVideo(videoId: string): Promise<void> {
    await this.shareRepository.delete({ videoId });
    console.log(`[DELETE] Deleted all shares for video ${videoId}`);
  }
}

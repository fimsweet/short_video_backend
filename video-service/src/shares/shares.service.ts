import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Share } from '../entities/share.entity';

@Injectable()
export class SharesService {
  constructor(
    @InjectRepository(Share)
    private shareRepository: Repository<Share>,
  ) {}

  async createShare(videoId: string, sharerId: string, recipientId: string): Promise<{ shareCount: number }> {
    console.log(`📤 Creating share: videoId=${videoId}, sharerId=${sharerId}, recipientId=${recipientId}`);
    
    // Create new share record
    await this.shareRepository.save({
      videoId,
      sharerId,
      recipientId,
    });

    const shareCount = await this.getShareCount(videoId);
    console.log(`✅ Share created, total count: ${shareCount}`);
    
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
    console.log(`🗑️ Deleted all shares for video ${videoId}`);
  }
}

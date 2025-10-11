import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Like } from '../entities/like.entity';

@Injectable()
export class LikesService {
  constructor(
    @InjectRepository(Like)
    private likeRepository: Repository<Like>,
  ) {}

  async toggleLike(videoId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    console.log(`🔄 Toggle like: videoId=${videoId}, userId=${userId}`);
    
    const existingLike = await this.likeRepository.findOne({
      where: { videoId, userId },
    });

    if (existingLike) {
      console.log('❌ Unlike - removing existing like');
      await this.likeRepository.remove(existingLike);
      const likeCount = await this.getLikeCount(videoId);
      return { liked: false, likeCount };
    } else {
      console.log('❤️ Like - creating new like');
      await this.likeRepository.save({
        videoId,
        userId,
      });
      const likeCount = await this.getLikeCount(videoId);
      return { liked: true, likeCount };
    }
  }

  async getLikeCount(videoId: string): Promise<number> {
    return this.likeRepository.count({ where: { videoId } });
  }

  async isLikedByUser(videoId: string, userId: string): Promise<boolean> {
    const like = await this.likeRepository.findOne({
      where: { videoId, userId },
    });
    const liked = !!like;
    console.log(`✅ isLikedByUser: videoId=${videoId}, userId=${userId}, result=${liked}`);
    return liked;
  }

  async getLikesByVideo(videoId: string): Promise<Like[]> {
    return this.likeRepository.find({
      where: { videoId },
      order: { createdAt: 'DESC' },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from '../entities/comment.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private commentRepository: Repository<Comment>,
  ) {}

  async createComment(videoId: string, userId: string, content: string): Promise<Comment> {
    const comment = this.commentRepository.create({
      videoId,
      userId,
      content,
    });
    return this.commentRepository.save(comment);
  }

  async getCommentsByVideo(videoId: string): Promise<Comment[]> {
    return this.commentRepository.find({
      where: { videoId },
      order: { createdAt: 'DESC' },
    });
  }

  async getCommentCount(videoId: string): Promise<number> {
    return this.commentRepository.count({ where: { videoId } });
  }

  async deleteComment(commentId: string, userId: string): Promise<boolean> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId, userId },
    });

    if (!comment) {
      return false;
    }

    await this.commentRepository.remove(comment);
    return true;
  }
}

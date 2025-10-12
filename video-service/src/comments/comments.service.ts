import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Comment } from '../entities/comment.entity';
import { CommentLike } from '../entities/comment-like.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private commentRepository: Repository<Comment>,
    @InjectRepository(CommentLike)
    private commentLikeRepository: Repository<CommentLike>,
  ) {}

  async createComment(videoId: string, userId: string, content: string, parentId?: string): Promise<Comment> {
    const comment = this.commentRepository.create({
      videoId,
      userId,
      content,
      parentId: parentId ?? null, // FIXED: Use ?? instead of ||
    });
    return this.commentRepository.save(comment);
  }

  async getCommentsByVideo(videoId: string): Promise<any[]> {
    const comments = await this.commentRepository.find({
      where: { videoId, parentId: IsNull() }, // FIXED: Use IsNull()
      order: { createdAt: 'DESC' },
    });

    // Get likes count and replies for each comment
    const commentsWithData = await Promise.all(
      comments.map(async (comment) => {
        const likeCount = await this.getCommentLikeCount(comment.id);
        const replyCount = await this.getReplyCount(comment.id);
        return {
          ...comment,
          likeCount,
          replyCount,
        };
      }),
    );

    return commentsWithData;
  }

  async getReplies(commentId: string): Promise<any[]> {
    const replies = await this.commentRepository.find({
      where: { parentId: commentId },
      order: { createdAt: 'ASC' },
    });

    const repliesWithData = await Promise.all(
      replies.map(async (reply) => {
        const likeCount = await this.getCommentLikeCount(reply.id);
        return {
          ...reply,
          likeCount,
        };
      }),
    );

    return repliesWithData;
  }

  async getCommentCount(videoId: string): Promise<number> {
    return this.commentRepository.count({ where: { videoId } });
  }

  async getReplyCount(commentId: string): Promise<number> {
    return this.commentRepository.count({ where: { parentId: commentId } });
  }

  async deleteComment(commentId: string, userId: string): Promise<boolean> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId, userId },
    });

    if (!comment) {
      return false;
    }

    // Delete all replies first
    await this.commentRepository.delete({ parentId: commentId });
    
    // Delete comment likes
    await this.commentLikeRepository.delete({ commentId });
    
    // Delete the comment
    await this.commentRepository.remove(comment);
    return true;
  }

  async toggleCommentLike(commentId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    const existingLike = await this.commentLikeRepository.findOne({
      where: { commentId, userId },
    });

    if (existingLike) {
      await this.commentLikeRepository.remove(existingLike);
      const likeCount = await this.getCommentLikeCount(commentId);
      return { liked: false, likeCount };
    } else {
      await this.commentLikeRepository.save({ commentId, userId });
      const likeCount = await this.getCommentLikeCount(commentId);
      return { liked: true, likeCount };
    }
  }

  async getCommentLikeCount(commentId: string): Promise<number> {
    return this.commentLikeRepository.count({ where: { commentId } });
  }

  async isCommentLikedByUser(commentId: string, userId: string): Promise<boolean> {
    const like = await this.commentLikeRepository.findOne({
      where: { commentId, userId },
    });
    return !!like;
  }
}

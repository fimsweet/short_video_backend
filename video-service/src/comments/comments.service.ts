import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Comment } from '../entities/comment.entity';
import { CommentLike } from '../entities/comment-like.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private commentRepository: Repository<Comment>,
    @InjectRepository(CommentLike)
    private commentLikeRepository: Repository<CommentLike>,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
  ) {}

  async createComment(videoId: string, userId: string, content: string, parentId?: string): Promise<Comment> {
    const comment = this.commentRepository.create({
      videoId,
      userId,
      content,
      parentId: parentId ?? null,
    });
    
    const savedComment = await this.commentRepository.save(comment);

    // Create notification for video owner
    try {
      // Get video to find owner using raw query
      const videos = await this.commentRepository.manager.query(
        'SELECT id, userId FROM videos WHERE id = ?',
        [videoId]
      );
      
      if (videos && videos.length > 0) {
        const video = videos[0];
        if (video.userId !== userId) {
          await this.notificationsService.createNotification(
            video.userId,
            userId,
            NotificationType.COMMENT,
            videoId,
            savedComment.id,
            content,
          );
        }
      }
    } catch (e) {
      console.error('Error creating comment notification:', e);
    }

    return savedComment;
  }

  async getCommentsByVideo(videoId: string): Promise<any[]> {
    const comments = await this.commentRepository.find({
      where: { videoId, parentId: IsNull() }, // FIXED: Use IsNull()
      order: { 
        isPinned: 'DESC', // Pinned comments first
        createdAt: 'DESC' 
      },
    });

    // Get likes count and replies for each comment, sort by likes
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

    // Sort by: 1) Pinned, 2) Like count, 3) Created date
    return commentsWithData.sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return b.isPinned ? 1 : -1; // Pinned first
      }
      if (a.likeCount !== b.likeCount) {
        return b.likeCount - a.likeCount; // Most liked first
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  async getReplies(commentId: string): Promise<any[]> {
    // Get direct replies to this comment
    const replies = await this.commentRepository.find({
      where: { parentId: commentId },
      order: { createdAt: 'ASC' },
    });

    // Get nested replies recursively
    const repliesWithData = await Promise.all(
      replies.map(async (reply) => {
        const likeCount = await this.getCommentLikeCount(reply.id);
        const nestedReplies = await this.getReplies(reply.id); // RECURSIVE: Get replies of replies
        return {
          ...reply,
          likeCount,
          replies: nestedReplies, // Include nested replies
        };
      }),
    );

    return repliesWithData;
  }

  async getCommentCount(videoId: string): Promise<number> {
    // Count ALL comments including nested replies
    return this.commentRepository.count({ where: { videoId } });
  }

  async getReplyCount(commentId: string): Promise<number> {
    // Count direct replies only (not nested)
    const directReplies = await this.commentRepository.count({ where: { parentId: commentId } });
    
    // Get all direct replies
    const replies = await this.commentRepository.find({ where: { parentId: commentId } });
    
    // Count nested replies recursively
    let nestedCount = 0;
    for (const reply of replies) {
      nestedCount += await this.getReplyCount(reply.id); // Recursive count
    }
    
    return directReplies + nestedCount; // Total count
  }

  async deleteComment(commentId: string, userId: string): Promise<boolean> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId, userId },
    });

    if (!comment) {
      return false;
    }

    // Recursively delete all nested replies first
    await this.deleteRepliesRecursively(commentId);
    
    // Delete comment likes
    await this.commentLikeRepository.delete({ commentId });
    
    // Delete the comment
    await this.commentRepository.remove(comment);
    return true;
  }

  private async deleteRepliesRecursively(commentId: string): Promise<void> {
    // Get all direct replies
    const replies = await this.commentRepository.find({ where: { parentId: commentId } });
    
    // For each reply, recursively delete its nested replies
    for (const reply of replies) {
      await this.deleteRepliesRecursively(reply.id);
      // Delete likes for this reply
      await this.commentLikeRepository.delete({ commentId: reply.id });
    }
    
    // Delete all direct replies
    await this.commentRepository.delete({ parentId: commentId });
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

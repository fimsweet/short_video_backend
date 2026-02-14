import { Injectable, Inject, forwardRef, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Comment } from '../entities/comment.entity';
import { CommentLike } from '../entities/comment-like.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';
import { ActivityLoggerService } from '../config/activity-logger.service';
import { PrivacyService } from '../config/privacy.service';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private commentRepository: Repository<Comment>,
    @InjectRepository(CommentLike)
    private commentLikeRepository: Repository<CommentLike>,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
    private activityLoggerService: ActivityLoggerService,
    private privacyService: PrivacyService,
  ) { }

  async createComment(videoId: string, userId: string, content: string, parentId?: string, imageUrl?: string | null): Promise<Comment> {
    // Get video to find owner for privacy check and check allowComments
    const videos = await this.commentRepository.manager.query(
      'SELECT id, userId, allowComments FROM videos WHERE id = ?',
      [videoId]
    );
    
    if (videos && videos.length > 0) {
      const video = videos[0];
      const videoOwnerId = video.userId;
      
      // Check if comments are allowed on this video
      if (video.allowComments === false || video.allowComments === 0) {
        throw new ForbiddenException('Comments are disabled for this video');
      }
      
      // Check if user is allowed to comment
      const canComment = await this.privacyService.canComment(userId, videoOwnerId);
      if (!canComment.allowed) {
        throw new ForbiddenException(canComment.reason || 'Bạn không được phép bình luận video này');
      }

      // Check if comment should be filtered for bad words (block posting)
      const shouldFilter = await this.privacyService.shouldFilterComment(videoOwnerId, content);
      if (shouldFilter) {
        throw new BadRequestException('Bình luận chứa nội dung không phù hợp');
      }
    }

    // Check toxicity with AI (non-blocking — flags but doesn't prevent posting)
    let isToxic = false;
    try {
      isToxic = await this.privacyService.checkToxicityWithAI(content);
    } catch (e) {
      console.error('Toxicity check error (non-blocking):', e);
    }

    // If replying to a reply, find the root parent comment
    let rootParentId = parentId;
    if (parentId) {
      const parentComment = await this.commentRepository.findOne({ where: { id: parentId } });
      if (parentComment && parentComment.parentId) {
        // This is a reply to a reply, use the root parent instead
        rootParentId = parentComment.parentId;
      }
    }

    const comment = this.commentRepository.create({
      videoId,
      userId,
      content,
      parentId: rootParentId ?? null,
      imageUrl: imageUrl ?? null,
      isToxic,
      censoredContent: isToxic ? this.privacyService.censorBadWords(content) : null,
    });

    const savedComment = await this.commentRepository.save(comment);

    // Create notification for video owner (reuse videos from privacy check)
    try {
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

    // Get video info for activity log
    let videoInfo: { id: string; title: string; thumbnailUrl: string; userId: string } | null = null;
    try {
      const videoResults = await this.commentRepository.manager.query(
        'SELECT id, title, thumbnailUrl, userId FROM videos WHERE id = ?',
        [videoId]
      );
      if (videoResults && videoResults.length > 0) {
        videoInfo = videoResults[0];
      }
    } catch (e) {
      console.error('Error getting video info for activity log:', e);
    }

    // Log comment activity with video details
    this.activityLoggerService.logActivity({
      userId: parseInt(userId),
      actionType: 'comment',
      targetId: videoId,
      targetType: 'video',
      metadata: { 
        content: content.substring(0, 100), 
        commentId: savedComment.id,
        videoTitle: videoInfo?.title,
        videoThumbnail: videoInfo?.thumbnailUrl,
        videoOwnerId: videoInfo?.userId,
      },
    });

    return savedComment;
  }

  async getCommentsByVideo(videoId: string, limit?: number, offset?: number): Promise<{ comments: any[]; hasMore: boolean; total: number }> {
    const take = limit || 20; // Default 20 comments per page
    const skip = offset || 0;

    // Get total count first
    const total = await this.commentRepository.count({
      where: { videoId, parentId: IsNull() },
    });

    const comments = await this.commentRepository.find({
      where: { videoId, parentId: IsNull() }, // FIXED: Use IsNull()
      order: {
        isPinned: 'DESC', // Pinned comments first
        createdAt: 'DESC'
      },
      take: take + 1, // Get one extra to check if there's more
      skip,
    });

    const hasMore = comments.length > take;
    const commentsToReturn = hasMore ? comments.slice(0, take) : comments;

    // Get likes count and replies for each comment, sort by likes
    const commentsWithData = await Promise.all(
      commentsToReturn.map(async (comment) => {
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
    const sortedComments = commentsWithData.sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return b.isPinned ? 1 : -1; // Pinned first
      }
      if (a.likeCount !== b.likeCount) {
        return b.likeCount - a.likeCount; // Most liked first
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return {
      comments: sortedComments,
      hasMore,
      total,
    };
  }

  async getReplies(commentId: string): Promise<any[]> {
    // Get ALL replies to this comment (flat structure, no nesting)
    const replies = await this.commentRepository.find({
      where: { parentId: commentId },
      order: { createdAt: 'ASC' },
    });

    // Get like counts for each reply (NO recursive nested replies)
    const repliesWithData = await Promise.all(
      replies.map(async (reply) => {
        const likeCount = await this.getCommentLikeCount(reply.id);
        return {
          ...reply,
          likeCount,
          // No nested replies - flat structure like TikTok/Facebook
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
    // Count only direct replies (flat structure)
    return this.commentRepository.count({ where: { parentId: commentId } });
  }

  async deleteComment(commentId: string, userId: string): Promise<boolean> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId, userId },
    });

    if (!comment) {
      return false;
    }

    const videoId = comment.videoId;

    // Recursively delete all nested replies first
    await this.deleteRepliesRecursively(commentId);

    // Delete comment likes
    await this.commentLikeRepository.delete({ commentId });

    // Delete the comment
    await this.commentRepository.remove(comment);

    // Log comment_deleted activity
    this.activityLoggerService.logActivity({
      userId: parseInt(userId),
      actionType: 'comment_deleted',
      targetId: videoId,
      targetType: 'video',
      metadata: { commentId },
    });

    return true;
  }

  async editComment(commentId: string, userId: string, newContent: string): Promise<Comment> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId, userId },
    });

    if (!comment) {
      throw new BadRequestException('Comment not found or you are not the author');
    }

    // Check if within 5 minutes edit window
    const now = new Date();
    const createdAt = new Date(comment.createdAt);
    const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
    if (diffMinutes > 5) {
      throw new BadRequestException('Chỉ có thể chỉnh sửa bình luận trong 5 phút');
    }

    // Check toxicity of new content with AI
    let isToxic = false;
    try {
      isToxic = await this.privacyService.checkToxicityWithAI(newContent);
    } catch (e) {
      console.error('Toxicity check error on edit (non-blocking):', e);
    }

    comment.content = newContent;
    comment.isEdited = true;
    comment.isToxic = isToxic;
    comment.censoredContent = isToxic ? this.privacyService.censorBadWords(newContent) : null;

    return this.commentRepository.save(comment);
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

  async deleteAllCommentsForVideo(videoId: string): Promise<void> {
    // Get all comments for this video (including replies)
    const comments = await this.commentRepository.find({ where: { videoId } });

    // Delete all comment likes for these comments
    for (const comment of comments) {
      await this.commentLikeRepository.delete({ commentId: comment.id });
    }

    // Delete all comments
    await this.commentRepository.delete({ videoId });
    console.log(`Deleted all comments and comment likes for video ${videoId}`);
  }
}

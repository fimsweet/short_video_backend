import { Controller, Post, Get, Delete, Param, Body } from '@nestjs/common';
import { CommentsService } from './comments.service';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  async createComment(@Body() body: { videoId: string; userId: string; content: string; parentId?: string }) {
    return this.commentsService.createComment(body.videoId, body.userId, body.content, body.parentId);
  }

  @Get('video/:videoId')
  async getCommentsByVideo(@Param('videoId') videoId: string) {
    return this.commentsService.getCommentsByVideo(videoId);
  }

  @Get('replies/:commentId')
  async getReplies(@Param('commentId') commentId: string) {
    return this.commentsService.getReplies(commentId);
  }

  @Get('count/:videoId')
  async getCommentCount(@Param('videoId') videoId: string) {
    const count = await this.commentsService.getCommentCount(videoId);
    return { count };
  }

  @Delete(':commentId/:userId')
  async deleteComment(@Param('commentId') commentId: string, @Param('userId') userId: string) {
    const deleted = await this.commentsService.deleteComment(commentId, userId);
    return { success: deleted };
  }

  @Post('like/toggle')
  async toggleCommentLike(@Body() body: { commentId: string; userId: string }) {
    return this.commentsService.toggleCommentLike(body.commentId, body.userId);
  }

  @Get('like/check/:commentId/:userId')
  async checkCommentLike(@Param('commentId') commentId: string, @Param('userId') userId: string) {
    const liked = await this.commentsService.isCommentLikedByUser(commentId, userId);
    return { liked };
  }
}

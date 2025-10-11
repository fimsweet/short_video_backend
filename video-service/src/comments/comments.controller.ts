import { Controller, Post, Get, Delete, Param, Body } from '@nestjs/common';
import { CommentsService } from './comments.service';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  async createComment(@Body() body: { videoId: string; userId: string; content: string }) {
    return this.commentsService.createComment(body.videoId, body.userId, body.content);
  }

  @Get('video/:videoId')
  async getCommentsByVideo(@Param('videoId') videoId: string) {
    return this.commentsService.getCommentsByVideo(videoId);
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
}

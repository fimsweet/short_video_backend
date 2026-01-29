import { Controller, Post, Get, Delete, Param, Body, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { CommentsService } from './comments.service';

// Use process.cwd() for reliable path resolution
const uploadDir = join(process.cwd(), 'uploads', 'comment_images');
console.log('📁 Comment images upload directory:', uploadDir);
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Created comment_images directory');
}

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image', {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const dest = join(process.cwd(), 'uploads', 'comment_images');
        console.log('📁 Saving file to:', dest);
        if (!existsSync(dest)) {
          mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = extname(file.originalname);
        const filename = `comment-${uniqueSuffix}${ext}`;
        console.log('📝 Generated filename:', filename);
        cb(null, filename);
      },
    }),
    fileFilter: (req, file, cb) => {
      console.log('📤 Received file:', file.originalname, file.mimetype);
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
        console.log('❌ File rejected - invalid mimetype:', file.mimetype);
        cb(null, false);
      } else {
        cb(null, true);
      }
    },
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB max
    },
  }))
  async createComment(
    @Body() body: { videoId: string; userId: string; content: string; parentId?: string },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    console.log('📥 createComment called with body:', body);
    console.log('📥 Uploaded file:', file ? { filename: file.filename, size: file.size, mimetype: file.mimetype } : 'No file');
    const imageUrl = file ? `/uploads/comment_images/${file.filename}` : null;
    console.log('📥 imageUrl:', imageUrl);
    return this.commentsService.createComment(body.videoId, body.userId, body.content, body.parentId, imageUrl);
  }

  @Get('video/:videoId')
  async getCommentsByVideo(
    @Param('videoId') videoId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? parseInt(offset, 10) : undefined;
    return this.commentsService.getCommentsByVideo(videoId, parsedLimit, parsedOffset);
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

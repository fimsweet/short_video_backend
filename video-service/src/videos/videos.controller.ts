import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  Body,
  Param,
  BadRequestException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VideosService } from './videos.service';
import { UploadVideoDto } from './dto/upload-video.dto';
import { multerConfig } from '../config/multer.config';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED) // 202 - giống POC
  @UseInterceptors(FileInterceptor('video', multerConfig))
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body() uploadVideoDto: UploadVideoDto,
  ) {
    if (!file) {
      throw new BadRequestException('No video file uploaded');
    }

    const video = await this.videosService.uploadVideo(uploadVideoDto, file);

    return {
      message: 'Video received and is being processed',
      videoId: video.id,
      status: video.status,
    };
  }

  @Get(':id')
  async getVideo(@Param('id') id: string) {
    return this.videosService.getVideoById(id);
  }

  @Get('user/:userId')
  async getUserVideos(@Param('userId') userId: string) {
    const videos = await this.videosService.getVideosByUserId(userId);
    return {
      success: true,
      data: videos,
    };
  }

  @Get('feed/all')
  async getFeed() {
    return this.videosService.getAllVideos(50);
  }

  @Get('feed/following/:userId')
  async getFollowingFeed(@Param('userId') userId: string) {
    return this.videosService.getFollowingVideos(parseInt(userId, 10), 50);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  async incrementViewCount(@Param('id') id: string) {
    const video = await this.videosService.incrementViewCount(id);
    return {
      success: true,
      viewCount: video.viewCount,
    };
  }

  @Post(':id/hide')
  @HttpCode(HttpStatus.OK)
  async toggleHideVideo(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    const video = await this.videosService.toggleHideVideo(id, userId);
    return {
      success: true,
      isHidden: video.isHidden,
      message: video.isHidden ? 'Video đã được ẩn' : 'Video đã hiện thị',
    };
  }

  @Post(':id/delete')
  @HttpCode(HttpStatus.OK)
  async deleteVideo(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    await this.videosService.deleteVideo(id, userId);
    return {
      success: true,
      message: 'Video đã được xóa',
    };
  }

  // Test endpoint to check thumbnail
  @Get('test/thumbnail/:videoId')
  async testThumbnail(@Param('videoId') videoId: string) {
    const video = await this.videosService.getVideoById(videoId);
    return {
      videoId,
      thumbnailUrl: video?.thumbnailUrl,
      hlsUrl: video?.hlsUrl,
      fullThumbnailUrl: video?.thumbnailUrl
        ? `http://localhost:3002${video.thumbnailUrl}`
        : null,
    };
  }
}

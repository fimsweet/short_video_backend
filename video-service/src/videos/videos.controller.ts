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
    return this.videosService.getVideosByUserId(userId);
  }

  @Get('feed/all')
  async getFeed() {
    return this.videosService.getAllVideos(50);
  }

  @Get('feed/following/:userId')
  async getFollowingFeed(@Param('userId') userId: string) {
    return this.videosService.getFollowingVideos(parseInt(userId, 10), 50);
  }
}

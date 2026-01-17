import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  Body,
  Param,
  Query,
  BadRequestException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VideosService } from './videos.service';
import { UploadVideoDto } from './dto/upload-video.dto';
import { multerConfig } from '../config/multer.config';
import { ChunkedUploadService } from './chunked-upload.service';
import { InitChunkedUploadDto, UploadChunkDto, CompleteChunkedUploadDto } from './dto/chunk-upload.dto';

@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly chunkedUploadService: ChunkedUploadService,
  ) { }

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

  @Get('search')
  async searchVideos(@Query('q') query: string) {
    const videos = await this.videosService.searchVideos(query);
    return {
      success: true,
      videos,
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

  // ==================== CHUNKED UPLOAD ENDPOINTS ====================

  @Post('chunked-upload/init')
  @HttpCode(HttpStatus.OK)
  async initChunkedUpload(@Body() dto: InitChunkedUploadDto) {
    const uploadId = this.chunkedUploadService.initUpload(
      dto.fileName,
      dto.fileSize,
      dto.totalChunks,
      dto.userId,
      dto.title,
      dto.description,
    );

    return {
      success: true,
      uploadId,
      message: 'Chunked upload session initialized',
    };
  }

  @Post('chunked-upload/chunk')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('chunk'))
  async uploadChunk(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadChunkDto,
  ) {
    if (!file) {
      throw new BadRequestException('No chunk uploaded');
    }

    const result = await this.chunkedUploadService.uploadChunk(
      dto.uploadId,
      parseInt(dto.chunkIndex as any),
      file.buffer,
    );

    return {
      success: true,
      uploadedChunks: result.uploadedChunks,
      totalChunks: result.totalChunks,
      progress: ((result.uploadedChunks / result.totalChunks) * 100).toFixed(2),
    };
  }

  @Post('chunked-upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  async completeChunkedUpload(@Body() dto: CompleteChunkedUploadDto) {
    const { filePath, fileName, metadata } = await this.chunkedUploadService.completeUpload(dto.uploadId);

    // Create video record and queue for processing
    const video = await this.videosService.uploadVideo(
      {
        userId: metadata.userId,
        title: metadata.title,
        description: metadata.description,
      },
      {
        filename: fileName,
        path: filePath,
        size: 0, // Will be calculated
      } as any,
    );

    return {
      success: true,
      message: 'Video received and is being processed',
      videoId: video.id,
      status: video.status,
    };
  }

  @Get('chunked-upload/status/:uploadId')
  async getChunkedUploadStatus(@Param('uploadId') uploadId: string) {
    const status = this.chunkedUploadService.getUploadStatus(uploadId);
    return {
      success: true,
      ...status,
      progress: ((status.uploadedChunks / status.totalChunks) * 100).toFixed(2),
    };
  }
}

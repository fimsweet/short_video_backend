import {
  Controller,
  Post,
  Get,
  Put,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Body,
  Param,
  Query,
  BadRequestException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { VideosService } from './videos.service';
import { UploadVideoDto } from './dto/upload-video.dto';
import { multerConfig, thumbnailMulterConfig } from '../config/multer.config';
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

  @Get('search')
  async searchVideos(@Query('q') query: string) {
    const videos = await this.videosService.searchVideos(query);
    return {
      success: true,
      videos,
    };
  }

  @Get('user/:userId')
  async getUserVideos(@Param('userId') userId: string, @Query('requesterId') requesterId?: string) {
    const result = await this.videosService.getVideosByUserId(userId, requesterId);
    return {
      success: true,
      data: result.videos,
      privacyRestricted: result.privacyRestricted || false,
      reason: result.reason,
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

  @Get('feed/friends/:userId')
  async getFriendsFeed(@Param('userId') userId: string) {
    return this.videosService.getFriendsVideos(parseInt(userId, 10), 50);
  }

  @Get('feed/following/:userId/new-count')
  async getFollowingNewCount(
    @Param('userId') userId: string,
    @Query('since') since: string,
  ) {
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.videosService.getFollowingNewVideoCount(parseInt(userId, 10), sinceDate);
    return { success: true, newCount: count };
  }

  @Get('feed/friends/:userId/new-count')
  async getFriendsNewCount(
    @Param('userId') userId: string,
    @Query('since') since: string,
  ) {
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.videosService.getFriendsNewVideoCount(parseInt(userId, 10), sinceDate);
    return { success: true, newCount: count };
  }

  // ⚠️ IMPORTANT: :id route must be LAST to avoid catching other routes
  @Get(':id')
  async getVideo(@Param('id') id: string, @Query('requesterId') requesterId?: string) {
    const video = await this.videosService.getVideoById(id);
    if (!video) return null;

    const isOwner = requesterId && video.userId === requesterId;

    // Block access to hidden videos for non-owners
    if (video.isHidden && !isOwner) {
      return null;
    }

    // Block access based on visibility for non-owners
    if (!isOwner) {
      if (video.visibility === 'private') {
        return null;
      }
      if (video.visibility === 'friends') {
        // Check if requester is a mutual friend
        try {
          const isFriend = await this.videosService.checkMutualFriend(requesterId!, video.userId);
          if (!isFriend) return null;
        } catch (e) {
          // If we can't check friendship, deny access for safety
          return null;
        }
      }
    }

    return video;
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
      visibility: video.visibility,
      allowComments: video.allowComments,
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

  @Put(':id/privacy')
  @HttpCode(HttpStatus.OK)
  async updateVideoPrivacy(
    @Param('id') id: string,
    @Body() privacySettings: {
      userId: string;
      visibility?: 'public' | 'friends' | 'private';
      allowComments?: boolean;
      allowDuet?: boolean;
    },
  ) {
    const video = await this.videosService.updateVideoPrivacy(id, privacySettings);
    return {
      success: true,
      isHidden: video.isHidden,
      visibility: video.visibility,
      allowComments: video.allowComments,
      allowDuet: video.allowDuet,
    };
  }

  @Put(':id/edit')
  @HttpCode(HttpStatus.OK)
  async editVideo(
    @Param('id') id: string,
    @Body() updateData: {
      userId: string;
      title?: string;
      description?: string;
    },
  ) {
    const video = await this.videosService.editVideo(id, updateData);
    return {
      success: true,
      video: {
        id: video.id,
        title: video.title,
        description: video.description,
      },
    };
  }

  @Put(':id/thumbnail')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('thumbnail', thumbnailMulterConfig))
  async updateThumbnail(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No thumbnail file uploaded');
    }

    const video = await this.videosService.updateThumbnail(id, userId, file);
    return {
      success: true,
      thumbnailUrl: video.thumbnailUrl,
      message: 'Thumbnail updated successfully',
    };
  }

  @Post('upload-with-thumbnail')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ], multerConfig))
  async uploadVideoWithThumbnail(
    @UploadedFiles() files: { video?: Express.Multer.File[], thumbnail?: Express.Multer.File[] },
    @Body() uploadVideoDto: UploadVideoDto,
  ) {
    if (!files.video || files.video.length === 0) {
      throw new BadRequestException('No video file uploaded');
    }

    const videoFile = files.video[0];
    const thumbnailFile = files.thumbnail?.[0];

    const video = await this.videosService.uploadVideoWithThumbnail(
      uploadVideoDto,
      videoFile,
      thumbnailFile,
    );

    return {
      message: 'Video received and is being processed',
      videoId: video.id,
      status: video.status,
      hasCustomThumbnail: !!thumbnailFile,
    };
  }

  // Endpoint for video-worker-service to invalidate cache after processing
  @Post(':id/processing-complete')
  @HttpCode(HttpStatus.OK)
  async onProcessingComplete(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    await this.videosService.invalidateCacheAfterProcessing(id, userId);
    return {
      success: true,
      message: 'Cache invalidated for video processing completion',
    };
  }

  // Retry a failed video processing job
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  async retryVideo(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const result = await this.videosService.retryFailedVideo(id, userId);
    return {
      success: true,
      message: 'Video has been re-queued for processing',
      videoId: result.id,
      status: result.status,
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

import { Controller, Get, Query, Post } from '@nestjs/common';
import { SearchService } from './search.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Video, VideoStatus } from '../entities/video.entity';

@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
  ) {}

  @Get('videos')
  async searchVideos(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    
    if (!this.searchService.isAvailable()) {
      return {
        success: true,
        source: 'sql',
        message: 'Elasticsearch not available, use SQL search endpoint',
        results: [],
      };
    }

    const results = await this.searchService.searchVideos(query, limitNum);
    return {
      success: true,
      source: 'elasticsearch',
      query,
      count: results.length,
      results,
    };
  }

  @Get('users')
  async searchUsers(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    
    if (!this.searchService.isAvailable()) {
      return {
        success: true,
        source: 'sql',
        message: 'Elasticsearch not available, use SQL search endpoint',
        results: [],
      };
    }

    const results = await this.searchService.searchUsers(query, limitNum);
    return {
      success: true,
      source: 'elasticsearch',
      query,
      count: results.length,
      results,
    };
  }

  @Get('status')
  async getStatus() {
    return {
      elasticsearch: this.searchService.isAvailable() ? 'connected' : 'disconnected',
      message: this.searchService.isAvailable() 
        ? 'Search is using Elasticsearch' 
        : 'Search is falling back to SQL',
    };
  }

  // Sync all existing videos to Elasticsearch
  @Post('sync/videos')
  async syncVideos() {
    if (!this.searchService.isAvailable()) {
      return {
        success: false,
        message: 'Elasticsearch is not available',
      };
    }

    try {
      // Get all ready videos from database
      const videos = await this.videoRepository.find({
        where: { status: VideoStatus.READY, isHidden: false },
      });

      console.log(`📦 Syncing ${videos.length} videos to Elasticsearch...`);

      // Transform to Elasticsearch documents
      const documents = videos.map((video) => ({
        id: video.id,
        userId: video.userId,
        title: video.title || '',
        description: video.description || '',
        thumbnailUrl: video.thumbnailUrl || '',
        hlsUrl: video.hlsUrl || '',
        aspectRatio: video.aspectRatio || '9:16',
        viewCount: video.viewCount || 0,
        likeCount: 0, // Will be updated on search
        commentCount: 0,
        createdAt: video.createdAt,
      }));

      // Bulk index
      await this.searchService.bulkIndexVideos(documents);

      return {
        success: true,
        message: `Synced ${videos.length} videos to Elasticsearch`,
        count: videos.length,
      };
    } catch (error) {
      console.error('❌ Error syncing videos:', error.message);
      return {
        success: false,
        message: error.message,
      };
    }
  }
}

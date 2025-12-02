import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { SharesService } from './shares.service';

@Controller('shares')
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Post()
  async createShare(@Body() body: { videoId: string; sharerId: string; recipientId: string }) {
    console.log('📤 Create share request:', body);
    const result = await this.sharesService.createShare(body.videoId, body.sharerId, body.recipientId);
    console.log('✅ Share result:', result);
    return result;
  }

  @Get('count/:videoId')
  async getShareCount(@Param('videoId') videoId: string) {
    const count = await this.sharesService.getShareCount(videoId);
    return { count };
  }

  @Get('video/:videoId')
  async getSharesByVideo(@Param('videoId') videoId: string) {
    return this.sharesService.getSharesByVideo(videoId);
  }
}

import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { SavedVideosService } from './saved-videos.service';

@Controller('saved-videos')
export class SavedVideosController {
  constructor(private readonly savedVideosService: SavedVideosService) {}

  @Post('toggle')
  async toggleSave(@Body() body: { videoId: string; userId: string }) {
    return this.savedVideosService.toggleSave(body.videoId, body.userId);
  }

  @Get('check/:videoId/:userId')
  async checkSaved(@Param('videoId') videoId: string, @Param('userId') userId: string) {
    const saved = await this.savedVideosService.isSavedByUser(videoId, userId);
    return { saved };
  }

  @Get('user/:userId')
  async getSavedVideos(@Param('userId') userId: string) {
    const videos = await this.savedVideosService.getSavedVideos(userId);
    return videos;
  }
}

import { Controller, Post, Get, Param, Body, BadRequestException } from '@nestjs/common';
import { FollowsService } from './follows.service';

@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post('toggle')
  async toggleFollow(@Body() body: { followerId: number; followingId: number }) {
    try {
      return await this.followsService.toggleFollow(body.followerId, body.followingId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get('check/:followerId/:followingId')
  async checkFollow(
    @Param('followerId') followerId: string,
    @Param('followingId') followingId: string,
  ) {
    const following = await this.followsService.isFollowing(
      parseInt(followerId, 10),
      parseInt(followingId, 10),
    );
    return { following };
  }

  @Get('followers/:userId')
  async getFollowers(@Param('userId') userId: string) {
    const followerIds = await this.followsService.getFollowers(parseInt(userId, 10));
    return { followerIds };
  }

  @Get('following/:userId')
  async getFollowing(@Param('userId') userId: string) {
    const followingIds = await this.followsService.getFollowing(parseInt(userId, 10));
    return { followingIds };
  }

  @Get('stats/:userId')
  async getStats(@Param('userId') userId: string) {
    const id = parseInt(userId, 10);
    const [followerCount, followingCount] = await Promise.all([
      this.followsService.getFollowerCount(id),
      this.followsService.getFollowingCount(id),
    ]);
    return { followerCount, followingCount };
  }
}

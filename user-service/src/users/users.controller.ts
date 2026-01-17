import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
  Query,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Request,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { multerConfig } from '../config/multer.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  // ============= USER SETTINGS ENDPOINTS (MUST BE BEFORE :username) =============

  // Get user settings
  @UseGuards(JwtAuthGuard)
  @Get('settings')
  async getUserSettings(@Request() req) {
    console.log('📥 GET /users/settings called');
    console.log('   Request headers:', req.headers);
    console.log('   User from JWT:', req.user);

    const userId = req.user.userId;
    console.log(`   Fetching settings for userId: ${userId}`);

    const settings = await this.usersService.getUserSettings(userId);
    console.log(`📤 Returning settings for userId ${userId}:`, settings);
    return {
      success: true,
      settings,
    };
  }

  // Update user settings
  @UseGuards(JwtAuthGuard)
  @Put('settings')
  async updateUserSettings(
    @Request() req,
    @Body() updateData: UpdateUserSettingsDto,
  ) {
    const userId = req.user.userId;
    const settings = await this.usersService.updateUserSettings(userId, updateData);
    return {
      success: true,
      message: 'Settings updated successfully',
      settings,
    };
  }

  // ============= USER ENDPOINTS =============

  // Search users by username or fullName
  @Get('search')
  async searchUsers(@Query('q') query: string) {
    const users = await this.usersService.searchUsers(query);
    return {
      success: true,
      users,
    };
  }

  @Get('id/:userId')
  async findById(@Param('userId') userId: string) {
    const user = await this.usersService.findById(parseInt(userId, 10));
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { password, ...result } = user;
    return result;
  }

  @Get(':username')
  findOne(@Param('username') username: string) {
    return this.usersService.findOne(username);
  }

  @UseGuards(JwtAuthGuard)
  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  async uploadAvatar(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const avatarUrl = `/uploads/avatars/${file.filename}`;
    const user = await this.usersService.updateAvatar(req.user.userId, avatarUrl);

    const { password, ...result } = user;
    return {
      message: 'Avatar uploaded successfully',
      user: result,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('avatar')
  async removeAvatar(@Request() req) {
    const user = await this.usersService.removeAvatar(req.user.userId);
    const { password, ...result } = user;
    return {
      message: 'Avatar removed successfully',
      user: result,
    };
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@Request() req, @Body() updateData: { bio?: string; website?: string; location?: string; gender?: string }) {
    const userId = req.user.userId;
    const updatedUser = await this.usersService.updateProfile(userId, updateData);
    return {
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    };
  }

  // Change password
  @Put('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Request() req,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    const userId = req.user.userId;
    const result = await this.usersService.changePassword(
      userId,
      body.currentPassword,
      body.newPassword,
    );
    return result;
  }

  // Block a user
  @Post('block/:targetUserId')
  async blockUser(
    @Body() body: { userId: string },
    @Param('targetUserId') targetUserId: string,
  ) {
    // For now, userId comes from body until auth is properly set up
    const blockerId = body.userId || '1'; // Default for testing
    await this.usersService.blockUser(parseInt(blockerId, 10), parseInt(targetUserId, 10));
    return { success: true, message: 'User blocked successfully' };
  }

  // Unblock a user
  @Delete('block/:targetUserId')
  async unblockUser(
    @Body() body: { userId: string },
    @Param('targetUserId') targetUserId: string,
  ) {
    const blockerId = body.userId || '1';
    await this.usersService.unblockUser(parseInt(blockerId, 10), parseInt(targetUserId, 10));
    return { success: true, message: 'User unblocked successfully' };
  }

  // Get list of blocked users
  @Get('blocked/:userId')
  async getBlockedUsers(@Param('userId') userId: string) {
    const blockedUsers = await this.usersService.getBlockedUsers(parseInt(userId, 10));
    return blockedUsers;
  }

  // Check if a user is blocked
  @Get('blocked/:userId/check/:targetUserId')
  async isUserBlocked(
    @Param('userId') userId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    const isBlocked = await this.usersService.isUserBlocked(
      parseInt(userId, 10),
      parseInt(targetUserId, 10),
    );
    return { isBlocked };
  }
}

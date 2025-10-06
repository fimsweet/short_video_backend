import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Request,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { multerConfig } from '../config/multer.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
}

import { Controller, Post, Body, ValidationPipe, UseGuards, Get, Request, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { OAuthRegisterDto, EmailRegisterDto, OAuthLoginDto } from './dto/oauth-login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Legacy register endpoint
  @Post('register')
  async register(@Body(ValidationPipe) createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  // New TikTok-style email registration
  @Post('register/email')
  async emailRegister(@Body(ValidationPipe) dto: EmailRegisterDto) {
    return this.authService.emailRegister(dto);
  }

  // Complete OAuth registration (after getting user info from Google/Facebook/Apple)
  @Post('register/oauth')
  async oauthRegister(@Body(ValidationPipe) dto: OAuthRegisterDto) {
    return this.authService.completeOAuthRegister(dto);
  }

  // Google OAuth - verify token and login/get user info
  @Post('oauth/google')
  async googleAuth(@Body(ValidationPipe) dto: OAuthLoginDto) {
    return this.authService.googleAuth(dto.idToken);
  }

  // Check username availability
  @Get('check-username')
  async checkUsername(@Query('username') username: string) {
    return this.authService.checkUsername(username);
  }

  // Check email availability
  @Get('check-email')
  async checkEmail(@Query('email') email: string) {
    return this.authService.checkEmail(email);
  }

  @Post('login')
  async login(@Body() loginDto: { username: string; password: string }) {
    return this.authService.login(loginDto.username, loginDto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
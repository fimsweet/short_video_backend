import { Controller, Post, Body, ValidationPipe, UseGuards, Get, Request, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { OAuthRegisterDto, EmailRegisterDto, OAuthLoginDto } from './dto/oauth-login.dto';
import { PhoneRegisterDto, PhoneLoginDto } from './dto/phone-register.dto';
import { SendLinkEmailOtpDto, VerifyLinkEmailDto, LinkPhoneDto } from './dto/account-link.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

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

  // Phone registration with Firebase token
  @Post('register/phone')
  async phoneRegister(@Body(ValidationPipe) dto: PhoneRegisterDto) {
    return this.authService.phoneRegister(dto);
  }

  // Phone login with Firebase token
  @Post('login/phone')
  async phoneLogin(@Body(ValidationPipe) dto: PhoneLoginDto) {
    return this.authService.phoneLogin(dto);
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

  // Check phone availability
  @Get('check-phone')
  async checkPhone(@Query('phone') phone: string) {
    return this.authService.checkPhone(phone);
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

  // ============= ACCOUNT LINKING ENDPOINTS (TikTok-style) =============

  // Get full account info with linked accounts
  @UseGuards(JwtAuthGuard)
  @Get('account-info')
  async getAccountInfo(@Request() req) {
    return this.authService.getAccountInfo(req.user.userId);
  }

  // Send OTP to email for linking to account
  @UseGuards(JwtAuthGuard)
  @Post('link/email/send-otp')
  async sendLinkEmailOtp(@Request() req, @Body(ValidationPipe) dto: SendLinkEmailOtpDto) {
    return this.authService.sendLinkEmailOtp(req.user.userId, dto.email);
  }

  // Verify OTP and link email to account
  @UseGuards(JwtAuthGuard)
  @Post('link/email/verify')
  async verifyLinkEmail(@Request() req, @Body(ValidationPipe) dto: VerifyLinkEmailDto) {
    return this.authService.verifyAndLinkEmail(req.user.userId, dto.email, dto.otp, dto.password);
  }

  // Link phone to account (using Firebase token)
  @UseGuards(JwtAuthGuard)
  @Post('link/phone')
  async linkPhone(@Request() req, @Body(ValidationPipe) dto: LinkPhoneDto) {
    return this.authService.linkPhone(req.user.userId, dto.firebaseIdToken);
  }

  // Check if phone is available for linking
  @UseGuards(JwtAuthGuard)
  @Get('link/phone/check')
  async checkPhoneForLink(@Request() req, @Query('phone') phone: string) {
    return this.authService.checkPhoneForLink(req.user.userId, phone);
  }

  // ============= TWO-FACTOR AUTHENTICATION =============

  // Get 2FA settings
  @UseGuards(JwtAuthGuard)
  @Get('2fa/settings')
  async get2FASettings(@Request() req) {
    return this.authService.get2FASettings(req.user.userId);
  }

  // Update 2FA settings
  @UseGuards(JwtAuthGuard)
  @Post('2fa/settings')
  async update2FASettings(
    @Request() req,
    @Body() dto: { enabled: boolean; methods: string[] },
  ) {
    return this.authService.update2FASettings(req.user.userId, dto.enabled, dto.methods);
  }

  // Send 2FA OTP (for login verification)
  @Post('2fa/send-otp')
  async send2FAOtp(@Body() dto: { userId: number; method: string }) {
    return this.authService.send2FAOtp(dto.userId, dto.method);
  }

  // Verify 2FA OTP
  @Post('2fa/verify')
  async verify2FA(@Body() dto: { userId: number; otp: string; method: string }) {
    return this.authService.verify2FA(dto.userId, dto.otp, dto.method);
  }

  // Send OTP for 2FA settings change (enable/disable)
  @UseGuards(JwtAuthGuard)
  @Post('2fa/send-settings-otp')
  async send2FASettingsOtp(@Request() req, @Body() dto: { method: string }) {
    return this.authService.send2FASettingsOtp(req.user.userId, dto.method);
  }

  // Verify OTP and update 2FA settings
  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify-settings')
  async verify2FASettings(
    @Request() req,
    @Body() dto: { otp: string; method: string; enabled: boolean; methods: string[] },
  ) {
    return this.authService.verify2FASettings(
      req.user.userId,
      dto.otp,
      dto.method,
      dto.enabled,
      dto.methods,
    );
  }

  // ============= FORGOT PASSWORD WITH PHONE =============

  // Check if phone exists for password reset
  @Get('forgot-password/check-phone')
  async checkPhoneForReset(@Query('phone') phone: string) {
    const exists = await this.authService.sendPhonePasswordResetOtp(phone);
    return exists;
  }

  // Reset password after Firebase phone verification
  @Post('forgot-password/phone/reset')
  async resetPasswordWithPhone(
    @Body() dto: { phone: string; firebaseIdToken: string; newPassword: string },
  ) {
    return this.authService.resetPasswordWithPhone(dto.phone, dto.firebaseIdToken, dto.newPassword);
  }
}
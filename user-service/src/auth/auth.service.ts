import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { OAuthRegisterDto, EmailRegisterDto } from './dto/oauth-login.dto';
import { PhoneRegisterDto, PhoneLoginDto } from './dto/phone-register.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '../entities/user.entity';
import { FirebaseAdminService } from './firebase-admin.service';
import { OtpService } from '../otp/otp.service';
import { EmailService } from '../config/email.service';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private firebaseAdminService: FirebaseAdminService,
    private otpService: OtpService,
    private emailService: EmailService,
  ) {
    // Initialize Google OAuth client
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  private async _generateToken(user: { id: number; username: string }) {
    const payload = { username: user.username, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  // Verify Google ID Token
  async verifyGoogleToken(idToken: string) {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });
      const payload = ticket.getPayload();

      if (!payload) {
        throw new BadRequestException('Invalid Google token');
      }

      return {
        providerId: payload.sub,
        email: payload.email,
        fullName: payload.name,
        avatar: payload.picture,
        emailVerified: payload.email_verified,
      };
    } catch (error) {
      throw new BadRequestException('Failed to verify Google token');
    }
  }

  // Google OAuth Login/Register
  async googleAuth(idToken: string) {
    const googleUser = await this.verifyGoogleToken(idToken);

    // Check if user exists with this Google ID
    let user = await this.usersService.findByProviderId('google', googleUser.providerId);

    if (user) {
      // Check if 2FA is enabled
      if (user.twoFactorEnabled && user.twoFactorMethods && user.twoFactorMethods.length > 0) {
        return {
          requires2FA: true,
          userId: user.id,
          twoFactorMethods: user.twoFactorMethods,
          message: 'Cần xác thực 2 yếu tố',
        };
      }

      // User exists, login
      const { password: _, ...userResult } = user;
      const token = await this._generateToken(user);
      return {
        message: 'Login successful',
        user: userResult,
        isNewUser: false,
        ...token,
      };
    }

    // Check if email already exists (TikTok-style: allow login if email was linked)
    if (googleUser.email) {
      const existingUser = await this.usersService.findByEmail(googleUser.email);
      if (existingUser) {
        // Check if 2FA is enabled
        if (existingUser.twoFactorEnabled && existingUser.twoFactorMethods && existingUser.twoFactorMethods.length > 0) {
          return {
            requires2FA: true,
            userId: existingUser.id,
            twoFactorMethods: existingUser.twoFactorMethods,
            message: 'Cần xác thực 2 yếu tố',
          };
        }

        // Email exists - this means user linked their Google email to an existing account
        // Allow login and update their Google providerId for future logins
        await this.usersService.linkGoogleToExistingAccount(existingUser.id, googleUser.providerId);

        const { password: _, ...userResult } = existingUser;
        const token = await this._generateToken(existingUser);
        console.log(`✅ Google login linked to existing account: ${existingUser.username}`);
        return {
          message: 'Login successful',
          user: userResult,
          isNewUser: false,
          ...token,
        };
      }
    }

    // Return Google user info for registration flow
    return {
      message: 'New user - complete registration',
      isNewUser: true,
      googleUser: {
        providerId: googleUser.providerId,
        email: googleUser.email,
        fullName: googleUser.fullName,
        avatar: googleUser.avatar,
      },
    };
  }

  // Complete OAuth Registration (Google/Facebook/Apple)
  async completeOAuthRegister(dto: OAuthRegisterDto) {
    // Check username availability
    const existingUsername = await this.usersService.findOne(dto.username);
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    // Check email availability
    const existingEmail = await this.usersService.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    // Create user with OAuth provider
    const user = await this.usersService.createOAuthUser({
      username: dto.username,
      email: dto.email,
      authProvider: dto.provider as AuthProvider,
      providerId: dto.providerId,
      fullName: dto.fullName,
      avatar: dto.avatar,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
    });

    const token = await this._generateToken(user);
    return {
      message: 'User registered successfully',
      user,
      ...token,
    };
  }

  // Email Registration (TikTok style - multi step)
  async emailRegister(dto: EmailRegisterDto) {
    // Check username availability
    const existingUsername = await this.usersService.findOne(dto.username);
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    // Check email availability
    const existingEmail = await this.usersService.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Create user
    const user = await this.usersService.createEmailUser({
      username: dto.username,
      email: dto.email,
      password: hashedPassword,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      fullName: dto.fullName,
    });

    const token = await this._generateToken(user);
    return {
      message: 'User registered successfully',
      user,
      ...token,
    };
  }

  // Phone Registration with Firebase ID Token
  async phoneRegister(dto: PhoneRegisterDto) {
    // Verify Firebase token and get phone number
    const { uid, phone } = await this.firebaseAdminService.verifyPhoneToken(dto.firebaseIdToken);
    console.log(`📱 Phone registration: ${phone} (Firebase UID: ${uid})`);

    // Check if phone already exists
    const existingPhone = await this.usersService.findByPhone(phone);
    if (existingPhone) {
      throw new ConflictException('Phone number already registered');
    }

    // Check username availability
    const existingUsername = await this.usersService.findOne(dto.username);
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    // Create user with phone
    const user = await this.usersService.createPhoneUser({
      username: dto.username,
      phone: phone,
      firebaseUid: uid,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      fullName: dto.fullName,
      language: dto.language,
    });

    const token = await this._generateToken(user);
    return {
      message: 'User registered successfully',
      user,
      ...token,
    };
  }

  // Phone Login with Firebase ID Token
  async phoneLogin(dto: PhoneLoginDto) {
    // Verify Firebase token and get phone number
    const { uid, phone } = await this.firebaseAdminService.verifyPhoneToken(dto.firebaseIdToken);
    console.log(`📱 Phone login: ${phone} (Firebase UID: ${uid})`);

    // Find user by phone
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      // Phone not registered - return info for registration
      return {
        message: 'Phone not registered',
        isNewUser: true,
        phone: phone,
      };
    }

    // User exists, login
    const { password: _, ...userResult } = user;
    const token = await this._generateToken(user);

    return {
      message: 'Login successful',
      user: userResult,
      isNewUser: false,
      ...token,
    };
  }

  // Check phone availability
  async checkPhone(phone: string) {
    const user = await this.usersService.findByPhone(phone);
    return {
      available: !user,
      phone,
    };
  }

  // Check username availability
  async checkUsername(username: string) {
    const user = await this.usersService.findOne(username);
    return {
      available: !user,
      username,
    };
  }

  // Check email availability
  async checkEmail(email: string) {
    const user = await this.usersService.findByEmail(email);
    return {
      available: !user,
      email,
    };
  }

  async register(createUserDto: CreateUserDto) {
    try {
      const user = await this.usersService.create(createUserDto);
      const token = await this._generateToken(user);
      return {
        message: 'User registered successfully',
        user,
        ...token,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new ConflictException('Registration failed');
    }
  }

  async login(usernameOrEmail: string, password: string) {
    // Tìm user bằng username hoặc email
    let user = await this.usersService.findOne(usernameOrEmail);

    // Nếu không tìm thấy bằng username, thử tìm bằng email
    if (!user) {
      user = await this.usersService.findByEmail(usernameOrEmail);
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user registered with OAuth (no password)
    if (!user.password) {
      throw new UnauthorizedException(`This account uses ${user.authProvider} login`);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled && user.twoFactorMethods && user.twoFactorMethods.length > 0) {
      // Return 2FA required response
      return {
        requires2FA: true,
        userId: user.id,
        twoFactorMethods: user.twoFactorMethods,
        message: 'Cần xác thực 2 yếu tố',
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userResult } = user;
    const token = await this._generateToken(user);

    return {
      message: 'Login successful',
      user: userResult,
      ...token,
    };
  }

  // ============= FORGOT PASSWORD WITH PHONE (TikTok-style) =============

  // Send OTP to phone for password reset (uses Firebase Phone Auth)
  async sendPhonePasswordResetOtp(phone: string) {
    // Check if phone exists
    const phoneExists = await this.usersService.phoneExists(phone);
    if (!phoneExists) {
      throw new BadRequestException('Số điện thoại không tồn tại trong hệ thống');
    }

    // Generate and store OTP
    const otp = await this.otpService.createOtp(phone, 'phone_password_reset');

    // For now, just return success - in production, you'd send SMS
    // Firebase Phone Auth handles SMS sending on the client side
    console.log(`📱 Phone password reset OTP for ${phone}: ${otp}`);

    return {
      success: true,
      message: 'Vui lòng xác thực số điện thoại qua Firebase',
      phone,
    };
  }

  // Verify phone and reset password (after Firebase verification)
  async resetPasswordWithPhone(phone: string, firebaseIdToken: string, newPassword: string) {
    // Verify Firebase token and get phone number
    const { uid, phone: verifiedPhone } = await this.firebaseAdminService.verifyPhoneToken(firebaseIdToken);

    // Make sure the phone matches
    if (verifiedPhone !== phone) {
      throw new BadRequestException('Số điện thoại không khớp');
    }

    // Reset password
    const result = await this.usersService.resetPasswordByPhone(phone, newPassword);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return {
      success: true,
      message: 'Đặt lại mật khẩu thành công',
    };
  }

  // ============= LINK EMAIL/PHONE TO ACCOUNT =============

  // Send OTP to email for linking
  async sendLinkEmailOtp(userId: number, email: string) {
    // Check if email already exists
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser && existingUser.id !== userId) {
      throw new ConflictException('Email này đã được sử dụng bởi tài khoản khác');
    }

    // Generate OTP
    const otp = await this.otpService.createOtp(email, 'link_email');

    // Send email
    const sent = await this.emailService.sendOtpEmail(email, otp);
    if (!sent) {
      throw new BadRequestException('Không thể gửi email. Vui lòng thử lại sau.');
    }

    console.log(`📧 Link email OTP for ${email}: ${otp}`);

    return {
      success: true,
      message: 'Mã xác nhận đã được gửi đến email',
    };
  }

  // Verify OTP and link email to account (password optional - only needed for phone users)
  async verifyAndLinkEmail(userId: number, email: string, otp: string, password?: string) {
    // Verify OTP
    await this.otpService.verifyOtp(email, otp, 'link_email');

    // Hash password if provided (for phone users who want email login)
    let hashedPassword: string | undefined;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Link email with optional password
    const result = await this.usersService.linkEmail(userId, email, hashedPassword);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    const message = password
      ? 'Email đã được liên kết thành công. Bạn có thể đăng nhập bằng email và mật khẩu này.'
      : 'Email đã được cập nhật thành công.';

    return {
      success: true,
      message,
    };
  }

  // Link phone to account (using Firebase token)
  async linkPhone(userId: number, firebaseIdToken: string) {
    // Verify Firebase token and get phone number
    const { uid, phone } = await this.firebaseAdminService.verifyPhoneToken(firebaseIdToken);

    console.log(`📱 Attempting to link phone ${phone} to user ${userId}`);

    // Check if phone already exists
    const existingUser = await this.usersService.findByPhone(phone);
    if (existingUser) {
      console.log(`📱 Phone ${phone} found - belongs to user ${existingUser.id}`);
      if (existingUser.id !== userId) {
        console.log(`❌ Phone ${phone} already belongs to different user ${existingUser.id}, rejecting link for user ${userId}`);
        throw new ConflictException('Số điện thoại này đã được sử dụng bởi tài khoản khác');
      }
    }

    // Link phone
    const result = await this.usersService.linkPhone(userId, phone, uid);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    console.log(`✅ Phone ${phone} linked successfully to user ${userId}`);
    return {
      success: true,
      message: 'Số điện thoại đã được liên kết thành công',
      phone,
    };
  }

  // Get account info with linked accounts
  async getAccountInfo(userId: number) {
    const accountInfo = await this.usersService.getAccountInfo(userId);
    if (!accountInfo) {
      throw new BadRequestException('Không tìm thấy tài khoản');
    }
    return accountInfo;
  }

  // Check if phone is available for linking (not used by another account)
  async checkPhoneForLink(userId: number, phone: string) {
    const existingUser = await this.usersService.findByPhone(phone);

    // Phone is available if:
    // 1. No one has it, OR
    // 2. Current user already has it (editing their own phone)
    const available = !existingUser || existingUser.id === userId;

    return {
      available,
      phone,
      message: available ? null : 'Số điện thoại này đã được sử dụng bởi tài khoản khác',
    };
  }

  // ============= TWO-FACTOR AUTHENTICATION =============

  // Get 2FA settings
  async get2FASettings(userId: number) {
    const settings = await this.usersService.get2FASettings(userId);
    if (!settings) {
      throw new BadRequestException('Không tìm thấy tài khoản');
    }
    return settings;
  }

  // Update 2FA settings
  async update2FASettings(userId: number, enabled: boolean, methods: string[]) {
    // Validate methods
    const validMethods = ['email', 'sms'];
    const filteredMethods = methods.filter(m => validMethods.includes(m));

    const result = await this.usersService.update2FASettings(userId, enabled, filteredMethods);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }
    return result;
  }

  // Send 2FA OTP for login verification
  async send2FAOtp(userId: number, method: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('Không tìm thấy tài khoản');
    }

    if (method === 'email') {
      if (!user.email || user.email.endsWith('@phone.user')) {
        throw new BadRequestException('Tài khoản chưa liên kết email');
      }

      // Generate and send OTP to email
      const otp = await this.otpService.createOtp(user.email, '2fa');
      const sent = await this.emailService.sendOtpEmail(user.email, otp);

      if (!sent) {
        throw new BadRequestException('Không thể gửi email xác thực');
      }

      console.log(`📧 2FA OTP sent to ${user.email}: ${otp}`);

      // Mask email for display
      const maskedEmail = user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
      return {
        success: true,
        message: `Mã xác thực đã được gửi đến ${maskedEmail}`,
        method: 'email',
      };
    } else if (method === 'sms') {
      if (!user.phoneNumber) {
        throw new BadRequestException('Tài khoản chưa liên kết số điện thoại');
      }

      // For SMS, we use Firebase Phone Auth on client side
      // Just return success to indicate SMS method is available
      const maskedPhone = user.phoneNumber.replace(/(.{4})(.*)(.{2})/, '$1***$3');
      return {
        success: true,
        message: `Xác thực qua số ${maskedPhone}`,
        method: 'sms',
        phoneNumber: user.phoneNumber, // Client will use this for Firebase
      };
    }

    throw new BadRequestException('Phương thức xác thực không hợp lệ');
  }

  // Verify 2FA OTP
  async verify2FA(userId: number, otp: string, method: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('Không tìm thấy tài khoản');
    }

    if (method === 'email') {
      if (!user.email) {
        throw new BadRequestException('Tài khoản chưa liên kết email');
      }

      // Verify OTP
      await this.otpService.verifyOtp(user.email, otp, '2fa');

      // Generate JWT token
      const payload = { sub: user.id, username: user.username };
      const token = this.jwtService.sign(payload);

      return {
        success: true,
        message: 'Xác thực thành công',
        access_token: token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phoneNumber: user.phoneNumber,
          avatar: user.avatar,
          fullName: user.fullName,
        },
      };
    }

    throw new BadRequestException('Phương thức xác thực không hợp lệ');
  }

  // Send OTP for 2FA settings change
  async send2FASettingsOtp(userId: number, method: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('Không tìm thấy tài khoản');
    }

    if (method === 'email') {
      if (!user.email) {
        throw new BadRequestException('Tài khoản chưa liên kết email');
      }

      // Create and send OTP
      await this.otpService.createOtp(user.email, '2fa_settings');

      // Mask email
      const maskedEmail = user.email.replace(/(.{2})(.*)(?=@)/, (_, a, b) => a + '*'.repeat(b.length));

      return {
        success: true,
        message: `Đã gửi mã xác thực đến ${maskedEmail}`,
        method: 'email',
      };
    }

    if (method === 'sms') {
      if (!user.phoneNumber) {
        throw new BadRequestException('Tài khoản chưa liên kết số điện thoại');
      }

      // Mask phone
      const maskedPhone = user.phoneNumber.replace(/(\+\d{2})(\d+)(\d{3})/, (_, a, b, c) => a + '*'.repeat(b.length) + c);

      return {
        success: true,
        message: `Xác thực qua số ${maskedPhone}`,
        method: 'sms',
        phoneNumber: user.phoneNumber, // Client will use this for Firebase
      };
    }

    throw new BadRequestException('Phương thức xác thực không hợp lệ');
  }

  // Verify OTP and update 2FA settings
  async verify2FASettings(
    userId: number,
    otp: string,
    method: string,
    enabled: boolean,
    methods: string[],
  ) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('Không tìm thấy tài khoản');
    }

    // Verify OTP based on method
    if (method === 'email') {
      if (!user.email) {
        throw new BadRequestException('Tài khoản chưa liên kết email');
      }

      // Verify OTP
      await this.otpService.verifyOtp(user.email, otp, '2fa_settings');
    } else if (method === 'sms') {
      // SMS OTP is verified by Firebase on client side
      // We trust the client has already verified with Firebase
      // In production, you may want to verify Firebase token here
    } else {
      throw new BadRequestException('Phương thức xác thực không hợp lệ');
    }

    // Update 2FA settings
    const validMethods = ['email', 'sms'];
    const filteredMethods = methods.filter(m => validMethods.includes(m));

    const result = await this.usersService.update2FASettings(userId, enabled, filteredMethods);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return {
      success: true,
      message: enabled ? 'Đã bật xác thực 2 bước' : 'Đã tắt xác thực 2 bước',
      enabled,
      methods: filteredMethods,
    };
  }
}
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { FirebaseAdminService } from './firebase-admin.service';
import { OtpService } from '../otp/otp.service';
import { EmailService } from '../config/email.service';
import { TotpService } from './totp.service';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: any;
  let jwtService: any;
  let configService: any;
  let firebaseService: any;
  let otpService: any;
  let emailService: any;
  let totpService: any;
  let hashedPassword: string;

  const mockUser = {
    id: 1,
    username: 'testuser',
    email: 'test@test.com',
    password: '$2b$10$hashedpassword',
    authProvider: 'email',
    isDeactivated: false,
    twoFactorEnabled: false,
    twoFactorMethods: [],
    phoneNumber: '+84123456789',
    fullName: 'Test User',
    avatar: 'avatar.jpg',
  };

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash('password123', 10);
  });

  beforeEach(async () => {
    usersService = {
      findOne: jest.fn(),
      findByEmail: jest.fn(),
      findByPhone: jest.fn(),
      findByProviderId: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      createOAuthUser: jest.fn(),
      createEmailUser: jest.fn(),
      createPhoneUser: jest.fn(),
      linkGoogleToExistingAccount: jest.fn(),
      phoneExists: jest.fn(),
      resetPasswordByPhone: jest.fn(),
      linkEmail: jest.fn(),
      linkPhone: jest.fn(),
      unlinkPhone: jest.fn(),
      getAccountInfo: jest.fn(),
      get2FASettings: jest.fn(),
      update2FASettings: jest.fn(),
      setTotpSecret: jest.fn(),
      getTotpSecret: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('jwt-token-mock'),
    };

    configService = {
      get: jest.fn().mockReturnValue('test-value'),
    };

    firebaseService = {
      verifyPhoneToken: jest.fn().mockResolvedValue({ uid: 'firebase-uid', phone: '+84123456789' }),
    };

    otpService = {
      createOtp: jest.fn().mockResolvedValue('123456'),
      verifyOtp: jest.fn().mockResolvedValue(true),
    };

    emailService = {
      sendOtpEmail: jest.fn().mockResolvedValue(true),
      send2FAOtpEmail: jest.fn().mockResolvedValue(true),
    };

    totpService = {
      createSecret: jest.fn().mockReturnValue('TOTP_SECRET'),
      generateKeyUri: jest.fn().mockReturnValue('otpauth://totp/...'),
      generateQRCode: jest.fn().mockResolvedValue('data:image/png;base64,...'),
      verifyToken: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: FirebaseAdminService, useValue: firebaseService },
        { provide: OtpService, useValue: otpService },
        { provide: EmailService, useValue: emailService },
        { provide: TotpService, useValue: totpService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ========== LOGIN ==========
  describe('login', () => {
    it('should login with valid username and password', async () => {
      usersService.findOne.mockResolvedValue({ ...mockUser, password: hashedPassword });
      const result = await service.login('testuser', 'password123');
      expect(result.message).toBe('Login successful');
      expect((result as any).access_token).toBeDefined();
    });

    it('should login with email when username not found', async () => {
      usersService.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, password: hashedPassword });
      const result = await service.login('test@test.com', 'password123');
      expect(result.message).toBe('Login successful');
    });

    it('should throw on invalid credentials (user not found)', async () => {
      usersService.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      await expect(service.login('nobody', 'wrong')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw for OAuth user without password', async () => {
      usersService.findOne.mockResolvedValue({ ...mockUser, password: null, authProvider: 'google' });
      await expect(service.login('testuser', 'password')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on wrong password', async () => {
      usersService.findOne.mockResolvedValue({ ...mockUser, password: hashedPassword });
      await expect(service.login('testuser', 'wrongpass')).rejects.toThrow(UnauthorizedException);
    });

    it('should prompt reactivation for deactivated account', async () => {
      usersService.findOne.mockResolvedValue({
        ...mockUser, password: hashedPassword, isDeactivated: true, deactivatedAt: new Date(),
      });
      const result = await service.login('testuser', 'password123');
      expect(result.requiresReactivation).toBe(true);
      expect((result as any).daysRemaining).toBeGreaterThan(0);
    });

    it('should throw when deactivated account expired (30+ days)', async () => {
      const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 31);
      usersService.findOne.mockResolvedValue({
        ...mockUser, password: hashedPassword, isDeactivated: true, deactivatedAt: oldDate,
      });
      await expect(service.login('testuser', 'password123')).rejects.toThrow(UnauthorizedException);
    });

    it('should require 2FA when enabled', async () => {
      usersService.findOne.mockResolvedValue({
        ...mockUser, password: hashedPassword, twoFactorEnabled: true, twoFactorMethods: ['email'],
      });
      const result = await service.login('testuser', 'password123');
      expect(result.requires2FA).toBe(true);
      expect((result as any).twoFactorMethods).toEqual(['email']);
    });

    it('should handle deactivated without deactivatedAt', async () => {
      usersService.findOne.mockResolvedValue({
        ...mockUser, password: hashedPassword, isDeactivated: true, deactivatedAt: null,
      });
      const result = await service.login('testuser', 'password123');
      expect(result.requiresReactivation).toBe(true);
      expect((result as any).daysRemaining).toBe(30);
    });
  });

  // ========== REGISTER ==========
  describe('register', () => {
    it('should register a new user', async () => {
      usersService.create.mockResolvedValue(mockUser);
      const result = await service.register({ username: 'newuser', password: 'password123', email: 'new@test.com' });
      expect(result.message).toBe('User registered successfully');
      expect(result.access_token).toBeDefined();
    });

    it('should throw on duplicate user (ConflictException)', async () => {
      usersService.create.mockRejectedValue(new ConflictException('exists'));
      await expect(service.register({ username: 'existing', password: 'pass', email: 'e@e.com' })).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException on generic error', async () => {
      usersService.create.mockRejectedValue(new Error('DB error'));
      await expect(service.register({ username: 'x', password: 'x', email: 'x@x.com' })).rejects.toThrow(ConflictException);
    });
  });

  // ========== EMAIL REGISTER ==========
  describe('emailRegister', () => {
    it('should register with email', async () => {
      usersService.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createEmailUser.mockResolvedValue(mockUser);
      const result = await service.emailRegister({ username: 'newuser', email: 'new@test.com', password: 'password123' } as any);
      expect(result.message).toBe('User registered successfully');
    });

    it('should hash password before creating user', async () => {
      usersService.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createEmailUser.mockResolvedValue(mockUser);
      await service.emailRegister({ username: 'newuser', email: 'new@test.com', password: 'mypassword' } as any);
      const calledWith = usersService.createEmailUser.mock.calls[0][0];
      expect(calledWith.password).not.toBe('mypassword');
      const isHashed = await bcrypt.compare('mypassword', calledWith.password);
      expect(isHashed).toBe(true);
    });

    it('should pass dateOfBirth when provided', async () => {
      usersService.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createEmailUser.mockResolvedValue(mockUser);
      await service.emailRegister({ username: 'u', email: 'e@e.com', password: 'p', dateOfBirth: '2000-01-01' });
      expect(usersService.createEmailUser.mock.calls[0][0].dateOfBirth).toBeInstanceOf(Date);
    });

    it('should throw on existing username', async () => {
      usersService.findOne.mockResolvedValue(mockUser);
      await expect(service.emailRegister({ username: 'testuser', email: 'new@test.com', password: 'p' } as any)).rejects.toThrow(ConflictException);
    });

    it('should throw on existing email', async () => {
      usersService.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(mockUser);
      await expect(service.emailRegister({ username: 'new', email: 'test@test.com', password: 'p' } as any)).rejects.toThrow(ConflictException);
    });
  });

  // ========== PHONE REGISTER ==========
  describe('phoneRegister', () => {
    it('should register with phone', async () => {
      usersService.findByPhone.mockResolvedValue(null);
      usersService.findOne.mockResolvedValue(null);
      usersService.createPhoneUser.mockResolvedValue(mockUser);
      const result = await service.phoneRegister({ firebaseIdToken: 'firebase-token', username: 'phoneuser' });
      expect(result.message).toBe('User registered successfully');
      expect(firebaseService.verifyPhoneToken).toHaveBeenCalledWith('firebase-token');
    });

    it('should throw on existing phone', async () => {
      usersService.findByPhone.mockResolvedValue(mockUser);
      await expect(service.phoneRegister({ firebaseIdToken: 'token', username: 'newuser' })).rejects.toThrow(ConflictException);
    });

    it('should throw on existing username', async () => {
      usersService.findByPhone.mockResolvedValue(null);
      usersService.findOne.mockResolvedValue(mockUser);
      await expect(service.phoneRegister({ firebaseIdToken: 'token', username: 'testuser' })).rejects.toThrow(ConflictException);
    });

    it('should pass optional fields (dateOfBirth, fullName, language)', async () => {
      usersService.findByPhone.mockResolvedValue(null);
      usersService.findOne.mockResolvedValue(null);
      usersService.createPhoneUser.mockResolvedValue(mockUser);
      await service.phoneRegister({ firebaseIdToken: 'token', username: 'u', dateOfBirth: '2000-01-01', fullName: 'Name', language: 'vi' });
      const args = usersService.createPhoneUser.mock.calls[0][0];
      expect(args.fullName).toBe('Name');
      expect(args.language).toBe('vi');
    });
  });

  // ========== PHONE LOGIN ==========
  describe('phoneLogin', () => {
    it('should login with phone', async () => {
      usersService.findByPhone.mockResolvedValue(mockUser);
      const result = await service.phoneLogin({ firebaseIdToken: 'token' });
      expect(result.message).toBe('Login successful');
      expect((result as any).access_token).toBeDefined();
    });

    it('should return isNewUser for unregistered phone', async () => {
      usersService.findByPhone.mockResolvedValue(null);
      const result = await service.phoneLogin({ firebaseIdToken: 'token' });
      expect(result.isNewUser).toBe(true);
      expect(result.phone).toBe('+84123456789');
    });

    it('should handle deactivated account', async () => {
      usersService.findByPhone.mockResolvedValue({ ...mockUser, isDeactivated: true, deactivatedAt: new Date() });
      const result = await service.phoneLogin({ firebaseIdToken: 'token' });
      expect(result.requiresReactivation).toBe(true);
    });

    it('should throw for expired deactivated (31+ days)', async () => {
      const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 31);
      usersService.findByPhone.mockResolvedValue({ ...mockUser, isDeactivated: true, deactivatedAt: oldDate });
      await expect(service.phoneLogin({ firebaseIdToken: 'token' })).rejects.toThrow(UnauthorizedException);
    });

    it('should handle deactivated without deactivatedAt', async () => {
      usersService.findByPhone.mockResolvedValue({ ...mockUser, isDeactivated: true, deactivatedAt: null });
      const result = await service.phoneLogin({ firebaseIdToken: 'token' });
      expect(result.requiresReactivation).toBe(true);
      expect((result as any).daysRemaining).toBe(30);
    });
  });

  // ========== CHECK AVAILABILITY ==========
  describe('checkUsername', () => {
    it('should return available when not taken', async () => {
      usersService.findOne.mockResolvedValue(null);
      const result = await service.checkUsername('newuser');
      expect(result.available).toBe(true);
    });
    it('should return unavailable when taken', async () => {
      usersService.findOne.mockResolvedValue(mockUser);
      expect((await service.checkUsername('testuser')).available).toBe(false);
    });
  });

  describe('checkEmail', () => {
    it('should return available', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      expect((await service.checkEmail('new@test.com')).available).toBe(true);
    });
    it('should return unavailable', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      expect((await service.checkEmail('test@test.com')).available).toBe(false);
    });
  });

  describe('checkPhone', () => {
    it('should return available', async () => {
      usersService.findByPhone.mockResolvedValue(null);
      expect((await service.checkPhone('+84999')).available).toBe(true);
    });
  });

  // ========== FORGOT PASSWORD WITH PHONE ==========
  describe('sendPhonePasswordResetOtp', () => {
    it('should send OTP for password reset', async () => {
      usersService.phoneExists.mockResolvedValue(true);
      const result = await service.sendPhonePasswordResetOtp('+84123456789');
      expect(result.success).toBe(true);
      expect(otpService.createOtp).toHaveBeenCalledWith('+84123456789', 'phone_password_reset');
    });

    it('should throw if phone not registered', async () => {
      usersService.phoneExists.mockResolvedValue(false);
      await expect(service.sendPhonePasswordResetOtp('+84999')).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPasswordWithPhone', () => {
    it('should reset password with verified phone', async () => {
      usersService.resetPasswordByPhone.mockResolvedValue({ success: true });
      const result = await service.resetPasswordWithPhone('+84123456789', 'firebase-token', 'newpass');
      expect(result.success).toBe(true);
    });

    it('should throw if phone mismatch', async () => {
      firebaseService.verifyPhoneToken.mockResolvedValue({ uid: 'uid', phone: '+84000000000' });
      await expect(service.resetPasswordWithPhone('+84123456789', 'token', 'newpass')).rejects.toThrow(BadRequestException);
    });

    it('should throw if reset fails', async () => {
      usersService.resetPasswordByPhone.mockResolvedValue({ success: false, message: 'Failed' });
      await expect(service.resetPasswordWithPhone('+84123456789', 'token', 'newpass')).rejects.toThrow(BadRequestException);
    });
  });

  // ========== GOOGLE AUTH ==========
  describe('googleAuth', () => {
    const googleUserData = {
      providerId: 'google-123',
      email: 'google@test.com',
      fullName: 'Google User',
      avatar: 'https://photo.url',
      emailVerified: true,
    };

    beforeEach(() => {
      jest.spyOn(service, 'verifyGoogleToken').mockResolvedValue(googleUserData);
    });

    it('should return new user info for unregistered Google user', async () => {
      usersService.findByProviderId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      const result = await service.googleAuth('google-id-token');
      expect(result.isNewUser).toBe(true);
      expect((result as any).googleUser.providerId).toBe('google-123');
    });

    it('should login existing Google user', async () => {
      usersService.findByProviderId.mockResolvedValue(mockUser);
      const result = await service.googleAuth('google-id-token');
      expect(result.message).toBe('Login successful');
      expect((result as any).access_token).toBeDefined();
    });

    it('should handle deactivated Google user', async () => {
      usersService.findByProviderId.mockResolvedValue({ ...mockUser, isDeactivated: true, deactivatedAt: new Date() });
      const result = await service.googleAuth('id-token');
      expect(result.requiresReactivation).toBe(true);
    });

    it('should throw for expired deactivated Google user', async () => {
      const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 31);
      usersService.findByProviderId.mockResolvedValue({ ...mockUser, isDeactivated: true, deactivatedAt: oldDate });
      await expect(service.googleAuth('id-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should require 2FA for Google user', async () => {
      usersService.findByProviderId.mockResolvedValue({ ...mockUser, twoFactorEnabled: true, twoFactorMethods: ['email'] });
      const result = await service.googleAuth('id-token');
      expect(result.requires2FA).toBe(true);
    });

    it('should link Google to existing email account', async () => {
      usersService.findByProviderId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(mockUser);
      const result = await service.googleAuth('id-token');
      expect(result.message).toBe('Login successful');
      expect(usersService.linkGoogleToExistingAccount).toHaveBeenCalledWith(1, 'google-123');
    });

    it('should handle deactivated existing email user during Google auth', async () => {
      usersService.findByProviderId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, isDeactivated: true, deactivatedAt: new Date() });
      const result = await service.googleAuth('id-token');
      expect(result.requiresReactivation).toBe(true);
    });

    it('should throw for expired deactivated email user during Google auth', async () => {
      const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 31);
      usersService.findByProviderId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, isDeactivated: true, deactivatedAt: oldDate });
      await expect(service.googleAuth('id-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should require 2FA for existing email user during Google auth', async () => {
      usersService.findByProviderId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, twoFactorEnabled: true, twoFactorMethods: ['sms'] });
      const result = await service.googleAuth('id-token');
      expect(result.requires2FA).toBe(true);
    });

    it('should handle deactivated Google user without deactivatedAt', async () => {
      usersService.findByProviderId.mockResolvedValue({ ...mockUser, isDeactivated: true, deactivatedAt: null });
      const result = await service.googleAuth('id-token');
      expect(result.requiresReactivation).toBe(true);
      expect((result as any).daysRemaining).toBe(30);
    });

    it('should handle deactivated email user without deactivatedAt', async () => {
      usersService.findByProviderId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, isDeactivated: true, deactivatedAt: null });
      const result = await service.googleAuth('id-token');
      expect(result.requiresReactivation).toBe(true);
    });

    it('should handle Google user with no email', async () => {
      jest.spyOn(service, 'verifyGoogleToken').mockResolvedValue({ ...googleUserData, email: undefined as any });
      usersService.findByProviderId.mockResolvedValue(null);
      const result = await service.googleAuth('id-token');
      expect(result.isNewUser).toBe(true);
    });
  });

  // ========== COMPLETE OAUTH REGISTER ==========
  describe('completeOAuthRegister', () => {
    it('should complete OAuth registration', async () => {
      usersService.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createOAuthUser.mockResolvedValue(mockUser);
      const result = await service.completeOAuthRegister({
        username: 'googleuser', email: 'google@test.com', provider: 'google', providerId: 'google-123', fullName: 'Google User',
      } as any);
      expect(result.message).toBe('User registered successfully');
    });

    it('should throw on existing username', async () => {
      usersService.findOne.mockResolvedValue(mockUser);
      await expect(service.completeOAuthRegister({ username: 'testuser', email: 'g@g.com', provider: 'google', providerId: 'g-1' } as any)).rejects.toThrow(ConflictException);
    });

    it('should throw on existing email', async () => {
      usersService.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(mockUser);
      await expect(service.completeOAuthRegister({ username: 'new', email: 'test@test.com', provider: 'google', providerId: 'g-1' } as any)).rejects.toThrow(ConflictException);
    });

    it('should pass dateOfBirth when provided', async () => {
      usersService.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createOAuthUser.mockResolvedValue(mockUser);
      await service.completeOAuthRegister({ username: 'u', email: 'e@e.com', provider: 'google', providerId: 'g-1', dateOfBirth: '2000-01-01' });
      expect(usersService.createOAuthUser.mock.calls[0][0].dateOfBirth).toBeInstanceOf(Date);
    });
  });

  // ========== SEND LINK EMAIL OTP ==========
  describe('sendLinkEmailOtp', () => {
    it('should send OTP for linking email', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const result = await service.sendLinkEmailOtp(1, 'newemail@test.com');
      expect(result.success).toBe(true);
      expect(otpService.createOtp).toHaveBeenCalledWith('newemail@test.com', 'link_email');
      expect(emailService.sendOtpEmail).toHaveBeenCalled();
    });

    it('should throw if email used by another user', async () => {
      usersService.findByEmail.mockResolvedValue({ id: 2, email: 'taken@test.com' });
      await expect(service.sendLinkEmailOtp(1, 'taken@test.com')).rejects.toThrow(ConflictException);
    });

    it('should allow if email belongs to same user', async () => {
      usersService.findByEmail.mockResolvedValue({ id: 1, email: 'my@test.com' });
      const result = await service.sendLinkEmailOtp(1, 'my@test.com');
      expect(result.success).toBe(true);
    });

    it('should throw if email sending fails', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      emailService.sendOtpEmail.mockResolvedValue(false);
      await expect(service.sendLinkEmailOtp(1, 'e@e.com')).rejects.toThrow(BadRequestException);
    });
  });

  // ========== VERIFY AND LINK EMAIL ==========
  describe('verifyAndLinkEmail', () => {
    it('should verify OTP and link email', async () => {
      usersService.linkEmail.mockResolvedValue({ success: true });
      const result = await service.verifyAndLinkEmail(1, 'e@e.com', '123456');
      expect(result.success).toBe(true);
      expect(otpService.verifyOtp).toHaveBeenCalledWith('e@e.com', '123456', 'link_email');
    });

    it('should hash password when provided', async () => {
      usersService.linkEmail.mockResolvedValue({ success: true });
      await service.verifyAndLinkEmail(1, 'e@e.com', '123456', 'mypassword');
      const calledPassword = usersService.linkEmail.mock.calls[0][2];
      expect(calledPassword).toBeDefined();
      const isValid = await bcrypt.compare('mypassword', calledPassword);
      expect(isValid).toBe(true);
    });

    it('should throw if linkEmail fails', async () => {
      usersService.linkEmail.mockResolvedValue({ success: false, message: 'Failed' });
      await expect(service.verifyAndLinkEmail(1, 'e@e.com', '123456')).rejects.toThrow(BadRequestException);
    });

    it('should include login message when password provided', async () => {
      usersService.linkEmail.mockResolvedValue({ success: true });
      const result = await service.verifyAndLinkEmail(1, 'e@e.com', '123456', 'pass');
      expect(result.message).toContain('đăng nhập');
    });
  });

  // ========== LINK PHONE ==========
  describe('linkPhone', () => {
    it('should link phone to account', async () => {
      usersService.findByPhone.mockResolvedValue(null);
      usersService.linkPhone.mockResolvedValue({ success: true });
      const result = await service.linkPhone(1, 'firebase-token');
      expect(result.success).toBe(true);
      expect(result.phone).toBe('+84123456789');
    });

    it('should throw if phone belongs to another user', async () => {
      usersService.findByPhone.mockResolvedValue({ id: 2 });
      await expect(service.linkPhone(1, 'token')).rejects.toThrow(ConflictException);
    });

    it('should allow if phone belongs to same user', async () => {
      usersService.findByPhone.mockResolvedValue({ id: 1 });
      usersService.linkPhone.mockResolvedValue({ success: true });
      const result = await service.linkPhone(1, 'token');
      expect(result.success).toBe(true);
    });

    it('should throw if linkPhone fails', async () => {
      usersService.findByPhone.mockResolvedValue(null);
      usersService.linkPhone.mockResolvedValue({ success: false, message: 'Failed' });
      await expect(service.linkPhone(1, 'token')).rejects.toThrow(BadRequestException);
    });
  });

  // ========== GET ACCOUNT INFO ==========
  describe('getAccountInfo', () => {
    it('should return account info', async () => {
      usersService.getAccountInfo.mockResolvedValue({ id: 1, email: 'e@e.com' });
      const result = await service.getAccountInfo(1);
      expect(result.id).toBe(1);
    });

    it('should throw if account not found', async () => {
      usersService.getAccountInfo.mockResolvedValue(null);
      await expect(service.getAccountInfo(999)).rejects.toThrow(BadRequestException);
    });
  });

  // ========== CHECK PHONE FOR LINK ==========
  describe('checkPhoneForLink', () => {
    it('should return available when no one has it', async () => {
      usersService.findByPhone.mockResolvedValue(null);
      const result = await service.checkPhoneForLink(1, '+84999');
      expect(result.available).toBe(true);
    });

    it('should return available when current user has it', async () => {
      usersService.findByPhone.mockResolvedValue({ id: 1 });
      const result = await service.checkPhoneForLink(1, '+84123');
      expect(result.available).toBe(true);
    });

    it('should return unavailable when another user has it', async () => {
      usersService.findByPhone.mockResolvedValue({ id: 2 });
      const result = await service.checkPhoneForLink(1, '+84123');
      expect(result.available).toBe(false);
      expect(result.message).toBeTruthy();
    });
  });

  // ========== UNLINK PHONE ==========
  describe('unlinkPhone', () => {
    it('should unlink phone with valid password', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, password: hashedPassword, email: 'real@email.com' });
      usersService.unlinkPhone.mockResolvedValue({ success: true });
      const result = await service.unlinkPhone(1, 'password123');
      expect(result.success).toBe(true);
    });

    it('should throw if user not found', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.unlinkPhone(1, 'pass')).rejects.toThrow(BadRequestException);
    });

    it('should throw if no phone linked', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, phoneNumber: null });
      await expect(service.unlinkPhone(1, 'pass')).rejects.toThrow(BadRequestException);
    });

    it('should throw on wrong password', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, password: hashedPassword, phoneNumber: '+84123' });
      await expect(service.unlinkPhone(1, 'wrongpass')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if no email and no OAuth', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, password: hashedPassword, phoneNumber: '+84123', email: null, authProvider: 'phone' });
      await expect(service.unlinkPhone(1, 'password123')).rejects.toThrow(BadRequestException);
    });

    it('should allow if user has OAuth provider', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, password: hashedPassword, phoneNumber: '+84123', email: null, authProvider: 'google' });
      usersService.unlinkPhone.mockResolvedValue({ success: true });
      const result = await service.unlinkPhone(1, 'password123');
      expect(result.success).toBe(true);
    });

    it('should throw if unlinkPhone fails', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, password: hashedPassword, email: 'a@a.com' });
      usersService.unlinkPhone.mockResolvedValue({ success: false, message: 'Failed' });
      await expect(service.unlinkPhone(1, 'password123')).rejects.toThrow(BadRequestException);
    });

    it('should skip password check if user has no password', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, password: null, phoneNumber: '+84123', email: 'a@a.com', authProvider: 'google' });
      usersService.unlinkPhone.mockResolvedValue({ success: true });
      const result = await service.unlinkPhone(1, '');
      expect(result.success).toBe(true);
    });

    it('should reject if email ends with @phone.user', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, password: hashedPassword, phoneNumber: '+84123', email: 'temp@phone.user', authProvider: 'phone' });
      await expect(service.unlinkPhone(1, 'password123')).rejects.toThrow(BadRequestException);
    });
  });

  // ========== 2FA SETTINGS ==========
  describe('get2FASettings', () => {
    it('should return 2FA settings', async () => {
      usersService.get2FASettings.mockResolvedValue({ enabled: false, methods: [] });
      const result = await service.get2FASettings(1);
      expect(result.enabled).toBe(false);
    });

    it('should throw if not found', async () => {
      usersService.get2FASettings.mockResolvedValue(null);
      await expect(service.get2FASettings(999)).rejects.toThrow(BadRequestException);
    });
  });

  describe('update2FASettings', () => {
    it('should filter and update 2FA methods', async () => {
      usersService.update2FASettings.mockResolvedValue({ success: true });
      const result = await service.update2FASettings(1, true, ['email', 'sms', 'invalid']);
      expect(usersService.update2FASettings).toHaveBeenCalledWith(1, true, ['email', 'sms']);
      expect(result.success).toBe(true);
    });

    it('should throw if update fails', async () => {
      usersService.update2FASettings.mockResolvedValue({ success: false, message: 'Failed' });
      await expect(service.update2FASettings(1, true, ['email'])).rejects.toThrow(BadRequestException);
    });
  });

  // ========== SEND 2FA OTP ==========
  describe('send2FAOtp', () => {
    it('should send 2FA OTP via email', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'test@test.com' });
      const result = await service.send2FAOtp(1, 'email');
      expect(result.success).toBe(true);
      expect(result.method).toBe('email');
      expect(otpService.createOtp).toHaveBeenCalled();
      expect(emailService.send2FAOtpEmail).toHaveBeenCalled();
    });

    it('should throw if user not found', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.send2FAOtp(999, 'email')).rejects.toThrow(BadRequestException);
    });

    it('should throw if no email linked', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: null });
      await expect(service.send2FAOtp(1, 'email')).rejects.toThrow(BadRequestException);
    });

    it('should throw if email ends with @phone.user', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'temp@phone.user' });
      await expect(service.send2FAOtp(1, 'email')).rejects.toThrow(BadRequestException);
    });

    it('should throw if email sending fails', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'test@test.com' });
      emailService.send2FAOtpEmail.mockResolvedValue(false);
      await expect(service.send2FAOtp(1, 'email')).rejects.toThrow(BadRequestException);
    });

    it('should handle SMS method', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, phoneNumber: '+84123456789' });
      const result = await service.send2FAOtp(1, 'sms');
      expect(result.method).toBe('sms');
      expect(result.phoneNumber).toBe('+84123456789');
    });

    it('should throw for sms if no phone linked', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, phoneNumber: null });
      await expect(service.send2FAOtp(1, 'sms')).rejects.toThrow(BadRequestException);
    });

    it('should throw for invalid method', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      await expect(service.send2FAOtp(1, 'invalid')).rejects.toThrow(BadRequestException);
    });
  });

  // ========== VERIFY 2FA ==========
  describe('verify2FA', () => {
    it('should verify via email', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'test@test.com' });
      const result = await service.verify2FA(1, '123456', 'email');
      expect(result.success).toBe(true);
      expect(result.access_token).toBeDefined();
      expect(otpService.verifyOtp).toHaveBeenCalledWith('test@test.com', '123456', '2fa');
    });

    it('should throw if user not found', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.verify2FA(999, '123456', 'email')).rejects.toThrow(BadRequestException);
    });

    it('should throw if no email for email method', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: null });
      await expect(service.verify2FA(1, '123456', 'email')).rejects.toThrow(BadRequestException);
    });

    it('should verify via TOTP', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      usersService.getTotpSecret.mockResolvedValue('secret');
      totpService.verifyToken.mockResolvedValue(true);
      const result = await service.verify2FA(1, '123456', 'totp');
      expect(result.success).toBe(true);
    });

    it('should throw if no totp secret set', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      usersService.getTotpSecret.mockResolvedValue(null);
      await expect(service.verify2FA(1, '123456', 'totp')).rejects.toThrow(BadRequestException);
    });

    it('should throw if totp token invalid', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      usersService.getTotpSecret.mockResolvedValue('secret');
      totpService.verifyToken.mockResolvedValue(false);
      await expect(service.verify2FA(1, '000000', 'totp')).rejects.toThrow(BadRequestException);
    });

    it('should verify via SMS (trusts client)', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, phoneNumber: '+84123' });
      const result = await service.verify2FA(1, '123456', 'sms');
      expect(result.success).toBe(true);
    });

    it('should throw if no phone for sms method', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, phoneNumber: null });
      await expect(service.verify2FA(1, '123456', 'sms')).rejects.toThrow(BadRequestException);
    });

    it('should throw for invalid method', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      await expect(service.verify2FA(1, '123456', 'invalid')).rejects.toThrow(BadRequestException);
    });
  });

  // ========== SEND 2FA SETTINGS OTP ==========
  describe('send2FASettingsOtp', () => {
    it('should send settings OTP via email', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'test@test.com' });
      const result = await service.send2FASettingsOtp(1, 'email');
      expect(result.success).toBe(true);
      expect(result.method).toBe('email');
    });

    it('should throw if user not found', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.send2FASettingsOtp(999, 'email')).rejects.toThrow(BadRequestException);
    });

    it('should throw if no email', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: null });
      await expect(service.send2FASettingsOtp(1, 'email')).rejects.toThrow(BadRequestException);
    });

    it('should throw if email send fails', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'test@test.com' });
      emailService.send2FAOtpEmail.mockResolvedValue(false);
      await expect(service.send2FASettingsOtp(1, 'email')).rejects.toThrow(BadRequestException);
    });

    it('should handle SMS method', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, phoneNumber: '+84123456789' });
      const result = await service.send2FASettingsOtp(1, 'sms');
      expect(result.method).toBe('sms');
      expect(result.phoneNumber).toBe('+84123456789');
    });

    it('should throw if no phone for sms', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, phoneNumber: null });
      await expect(service.send2FASettingsOtp(1, 'sms')).rejects.toThrow(BadRequestException);
    });

    it('should throw for invalid method', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      await expect(service.send2FASettingsOtp(1, 'invalid')).rejects.toThrow(BadRequestException);
    });
  });

  // ========== VERIFY 2FA SETTINGS ==========
  describe('verify2FASettings', () => {
    it('should verify email OTP and update settings', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'test@test.com' });
      usersService.update2FASettings.mockResolvedValue({ success: true });
      const result = await service.verify2FASettings(1, '123456', 'email', true, ['email']);
      expect(result.success).toBe(true);
      expect(result.enabled).toBe(true);
    });

    it('should throw if user not found', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.verify2FASettings(999, '123456', 'email', true, ['email'])).rejects.toThrow(BadRequestException);
    });

    it('should throw if no email for email method', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: null });
      await expect(service.verify2FASettings(1, '123456', 'email', true, ['email'])).rejects.toThrow(BadRequestException);
    });

    it('should handle SMS method (trusts client)', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      usersService.update2FASettings.mockResolvedValue({ success: true });
      const result = await service.verify2FASettings(1, '123456', 'sms', true, ['sms']);
      expect(result.success).toBe(true);
    });

    it('should verify TOTP method', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      usersService.getTotpSecret.mockResolvedValue('secret');
      totpService.verifyToken.mockResolvedValue(true);
      usersService.update2FASettings.mockResolvedValue({ success: true });
      const result = await service.verify2FASettings(1, '123456', 'totp', true, ['totp']);
      expect(result.success).toBe(true);
    });

    it('should throw if no totp secret', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      usersService.getTotpSecret.mockResolvedValue(null);
      await expect(service.verify2FASettings(1, '123456', 'totp', true, ['totp'])).rejects.toThrow(BadRequestException);
    });

    it('should throw if totp token invalid', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      usersService.getTotpSecret.mockResolvedValue('secret');
      totpService.verifyToken.mockResolvedValue(false);
      await expect(service.verify2FASettings(1, '000000', 'totp', true, ['totp'])).rejects.toThrow(BadRequestException);
    });

    it('should throw for invalid method', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      await expect(service.verify2FASettings(1, '123456', 'invalid', true, ['email'])).rejects.toThrow(BadRequestException);
    });

    it('should clear totp secret when totp removed from methods', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'e@e.com' });
      usersService.update2FASettings.mockResolvedValue({ success: true });
      await service.verify2FASettings(1, '123456', 'email', false, ['email']);
      expect(usersService.setTotpSecret).toHaveBeenCalledWith(1, null);
    });

    it('should not clear totp secret when totp still in methods', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'e@e.com' });
      usersService.update2FASettings.mockResolvedValue({ success: true });
      await service.verify2FASettings(1, '123456', 'email', true, ['email', 'totp']);
      expect(usersService.setTotpSecret).not.toHaveBeenCalled();
    });

    it('should filter invalid methods', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'e@e.com' });
      usersService.update2FASettings.mockResolvedValue({ success: true });
      await service.verify2FASettings(1, '123456', 'email', true, ['email', 'invalid', 'totp']);
      expect(usersService.update2FASettings).toHaveBeenCalledWith(1, true, ['email', 'totp']);
    });

    it('should throw if update fails', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'e@e.com' });
      usersService.update2FASettings.mockResolvedValue({ success: false, message: 'Failed' });
      await expect(service.verify2FASettings(1, '123456', 'email', true, ['email'])).rejects.toThrow(BadRequestException);
    });

    it('should return disabled message when disabling 2FA', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, email: 'e@e.com' });
      usersService.update2FASettings.mockResolvedValue({ success: true });
      const result = await service.verify2FASettings(1, '123456', 'email', false, []);
      expect(result.message).toContain('tắt');
    });
  });

  // ========== TOTP SETUP ==========
  describe('setupTotp', () => {
    it('should generate TOTP secret and QR code', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      const result = await service.setupTotp(1);
      expect(result.success).toBe(true);
      expect(result.secret).toBe('TOTP_SECRET');
      expect(result.qrCodeUrl).toBeDefined();
      expect(totpService.createSecret).toHaveBeenCalled();
      expect(totpService.generateKeyUri).toHaveBeenCalledWith('testuser', 'TOTP_SECRET');
    });

    it('should throw if user not found', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.setupTotp(999)).rejects.toThrow(BadRequestException);
    });

    it('should use email as account name if no username', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, username: null, email: 'e@e.com' });
      await service.setupTotp(1);
      expect(totpService.generateKeyUri).toHaveBeenCalledWith('e@e.com', 'TOTP_SECRET');
    });

    it('should use user_id as fallback account name', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, id: 5, username: null, email: null });
      await service.setupTotp(5);
      expect(totpService.generateKeyUri).toHaveBeenCalledWith('user_5', 'TOTP_SECRET');
    });
  });

  // ========== VERIFY TOTP SETUP ==========
  describe('verifyTotpSetup', () => {
    it('should verify token and save secret', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, twoFactorMethods: [] });
      usersService.update2FASettings.mockResolvedValue({ success: true });
      const result = await service.verifyTotpSetup(1, '123456', 'SECRET');
      expect(result.success).toBe(true);
      expect(usersService.setTotpSecret).toHaveBeenCalledWith(1, 'SECRET');
      expect(usersService.update2FASettings).toHaveBeenCalledWith(1, true, ['totp']);
    });

    it('should throw if user not found', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.verifyTotpSetup(999, '123456', 'SECRET')).rejects.toThrow(BadRequestException);
    });

    it('should throw if token invalid', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      totpService.verifyToken.mockResolvedValue(false);
      await expect(service.verifyTotpSetup(1, '000000', 'SECRET')).rejects.toThrow(BadRequestException);
    });

    it('should not duplicate totp in methods', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, twoFactorMethods: ['email', 'totp'] });
      usersService.update2FASettings.mockResolvedValue({ success: true });
      const result = await service.verifyTotpSetup(1, '123456', 'SECRET');
      expect(result.methods).toContain('totp');
      // Should not have duplicates
      expect(result.methods.filter((m: string) => m === 'totp').length).toBe(1);
    });
  });
});

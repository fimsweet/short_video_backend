import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsService } from '../sessions/sessions.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: any;
  let sessionsService: any;

  const mockReq = { user: { userId: 1, username: 'testuser' } };
  const loginResult = {
    message: 'Login successful',
    access_token: 'jwt-token',
    user: { id: 1, username: 'testuser' },
  };

  beforeEach(async () => {
    authService = {
      register: jest.fn().mockResolvedValue(loginResult),
      emailRegister: jest.fn().mockResolvedValue(loginResult),
      phoneRegister: jest.fn().mockResolvedValue(loginResult),
      phoneLogin: jest.fn().mockResolvedValue(loginResult),
      completeOAuthRegister: jest.fn().mockResolvedValue(loginResult),
      googleAuth: jest.fn().mockResolvedValue(loginResult),
      checkUsername: jest.fn().mockResolvedValue({ available: true }),
      checkEmail: jest.fn().mockResolvedValue({ available: true }),
      checkPhone: jest.fn().mockResolvedValue({ available: true }),
      login: jest.fn().mockResolvedValue(loginResult),
      getAccountInfo: jest.fn().mockResolvedValue({ id: 1 }),
      sendLinkEmailOtp: jest.fn().mockResolvedValue({ success: true }),
      verifyAndLinkEmail: jest.fn().mockResolvedValue({ success: true }),
      linkPhone: jest.fn().mockResolvedValue({ success: true }),
      checkPhoneForLink: jest.fn().mockResolvedValue({ available: true }),
      unlinkPhone: jest.fn().mockResolvedValue({ success: true }),
      get2FASettings: jest.fn().mockResolvedValue({ enabled: false }),
      update2FASettings: jest.fn().mockResolvedValue({ success: true }),
      send2FAOtp: jest.fn().mockResolvedValue({ success: true }),
      verify2FA: jest.fn().mockResolvedValue(loginResult),
      send2FASettingsOtp: jest.fn().mockResolvedValue({ success: true }),
      verify2FASettings: jest.fn().mockResolvedValue({ success: true }),
      setupTotp: jest.fn().mockResolvedValue({ qrCodeUrl: 'data:...' }),
      verifyTotpSetup: jest.fn().mockResolvedValue({ success: true }),
      sendPhonePasswordResetOtp: jest.fn().mockResolvedValue({ success: true }),
      resetPasswordWithPhone: jest.fn().mockResolvedValue({ success: true }),
    };

    sessionsService = {
      createSession: jest.fn().mockResolvedValue({ id: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SessionsService, useValue: sessionsService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should register and create session', async () => {
      const dto = { username: 'new', password: 'pass', email: 'e@e.com' };
      const result = await controller.register(dto as any, '127.0.0.1', '');
      expect(result.message).toBe('Login successful');
      expect(sessionsService.createSession).toHaveBeenCalled();
    });
  });

  describe('emailRegister', () => {
    it('should register with email', async () => {
      const dto = { username: 'u', email: 'e@e.com', password: 'p' };
      const result = await controller.emailRegister(dto as any, '127.0.0.1', '');
      expect((result as any).access_token).toBeDefined();
    });
  });

  describe('phoneRegister', () => {
    it('should register with phone', async () => {
      const dto = { firebaseIdToken: 'token', username: 'u' };
      const result = await controller.phoneRegister(dto as any, '127.0.0.1', '');
      expect((result as any).access_token).toBeDefined();
    });
  });

  describe('phoneLogin', () => {
    it('should login with phone', async () => {
      const result = await controller.phoneLogin({ firebaseIdToken: 'token' } as any, '127.0.0.1', '');
      expect((result as any).access_token).toBeDefined();
    });
  });

  describe('oauthRegister', () => {
    it('should complete OAuth registration', async () => {
      const dto = { username: 'u', email: 'e@e.com', provider: 'google', providerId: 'gid' };
      const result = await controller.oauthRegister(dto as any, '127.0.0.1', '');
      expect((result as any).access_token).toBeDefined();
    });
  });

  describe('googleAuth', () => {
    it('should handle Google OAuth', async () => {
      const result = await controller.googleAuth({ idToken: 'gtoken' } as any, '127.0.0.1', '');
      expect((result as any).access_token).toBeDefined();
    });
  });

  describe('checkUsername', () => {
    it('should check username availability', async () => {
      const result = await controller.checkUsername('testuser');
      expect(result.available).toBe(true);
    });
  });

  describe('checkEmail', () => {
    it('should check email availability', async () => {
      const result = await controller.checkEmail('e@e.com');
      expect(result.available).toBe(true);
    });
  });

  describe('checkPhone', () => {
    it('should check phone availability', async () => {
      const result = await controller.checkPhone('+84123');
      expect(result.available).toBe(true);
    });
  });

  describe('login', () => {
    it('should login with username/password and create session', async () => {
      const dto = { username: 'testuser', password: 'pass123' };
      const result = await controller.login(dto, '127.0.0.1', '');
      expect(result.message).toBe('Login successful');
      expect(sessionsService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, token: 'jwt-token' }),
      );
    });

    it('should use forwarded IP when available', async () => {
      const dto = { username: 'testuser', password: 'pass123' };
      await controller.login(dto, '127.0.0.1', '10.0.0.1, 192.168.1.1');
      expect(sessionsService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: '10.0.0.1' }),
      );
    });

    it('should pass device info to session', async () => {
      const dto = {
        username: 'testuser',
        password: 'pass123',
        deviceInfo: { platform: 'ios' as any, deviceName: 'iPhone 15' },
      };
      await controller.login(dto, '127.0.0.1', '');
      expect(sessionsService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'ios', deviceName: 'iPhone 15' }),
      );
    });
  });

  describe('getProfile', () => {
    it('should return user from request', () => {
      const result = controller.getProfile(mockReq);
      expect(result).toEqual(mockReq.user);
    });
  });

  describe('account linking', () => {
    it('should get account info', async () => {
      const result = await controller.getAccountInfo(mockReq);
      expect(authService.getAccountInfo).toHaveBeenCalledWith(1);
    });

    it('should send link email OTP', async () => {
      const result = await controller.sendLinkEmailOtp(mockReq, { email: 'e@e.com' } as any);
      expect(result.success).toBe(true);
    });

    it('should verify and link email', async () => {
      const dto = { email: 'e@e.com', otp: '123456', password: 'pass' } as any;
      const result = await controller.verifyLinkEmail(mockReq, dto);
      expect(result.success).toBe(true);
    });

    it('should link phone', async () => {
      const result = await controller.linkPhone(mockReq, { firebaseIdToken: 'token' } as any);
      expect(result.success).toBe(true);
    });

    it('should check phone for link', async () => {
      const result = await controller.checkPhoneForLink(mockReq, '+84123');
      expect(result.available).toBe(true);
    });

    it('should unlink phone', async () => {
      const result = await controller.unlinkPhone(mockReq, { password: 'pass' });
      expect(result.success).toBe(true);
    });
  });

  describe('2FA', () => {
    it('should get 2FA settings', async () => {
      await controller.get2FASettings(mockReq);
      expect(authService.get2FASettings).toHaveBeenCalledWith(1);
    });

    it('should update 2FA settings', async () => {
      await controller.update2FASettings(mockReq, { enabled: true, methods: ['email'] });
      expect(authService.update2FASettings).toHaveBeenCalledWith(1, true, ['email']);
    });

    it('should send 2FA OTP', async () => {
      await controller.send2FAOtp({ userId: 1, method: 'email' });
      expect(authService.send2FAOtp).toHaveBeenCalledWith(1, 'email');
    });

    it('should verify 2FA', async () => {
      const result = await controller.verify2FA(
        { userId: 1, otp: '123456', method: 'email' },
        '127.0.0.1',
        '',
      );
      expect((result as any).access_token).toBeDefined();
    });

    it('should send 2FA settings OTP', async () => {
      await controller.send2FASettingsOtp(mockReq, { method: 'email' });
      expect(authService.send2FASettingsOtp).toHaveBeenCalledWith(1, 'email');
    });

    it('should verify 2FA settings', async () => {
      await controller.verify2FASettings(mockReq, {
        otp: '123456', method: 'email', enabled: true, methods: ['email'],
      });
      expect(authService.verify2FASettings).toHaveBeenCalledWith(1, '123456', 'email', true, ['email']);
    });
  });

  describe('TOTP', () => {
    it('should setup TOTP', async () => {
      const result = await controller.setupTotp(mockReq);
      expect(result.qrCodeUrl).toBeDefined();
    });

    it('should verify TOTP setup', async () => {
      const result = await controller.verifyTotpSetup(mockReq, { token: '123456', secret: 'SECRET' });
      expect(result.success).toBe(true);
    });
  });

  describe('forgot password', () => {
    it('should check phone for reset', async () => {
      const result = await controller.checkPhoneForReset('+84123');
      expect(result.success).toBe(true);
    });

    it('should reset password with phone', async () => {
      const result = await controller.resetPasswordWithPhone({
        phone: '+84123', firebaseIdToken: 'token', newPassword: 'newpass',
      });
      expect(result.success).toBe(true);
    });
  });
});

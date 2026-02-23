import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' }),
  }),
}));

describe('EmailService', () => {
  let service: EmailService;
  let configService: any;

  describe('when configured', () => {
    beforeEach(async () => {
      configService = {
        get: jest.fn().mockImplementation((key: string) => {
          const map: Record<string, string> = {
            EMAIL_USER: 'test@gmail.com',
            EMAIL_APP_PASSWORD: 'test-password',
          };
          return map[key];
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should send OTP email', async () => {
      const result = await service.sendOtpEmail('user@test.com', '123456');
      expect(result).toBe(true);
    });

    it('should send 2FA OTP email', async () => {
      const result = await service.send2FAOtpEmail('user@test.com', '654321');
      expect(result).toBe(true);
    });

    it('should send welcome email', async () => {
      const result = await service.sendWelcomeEmail('user@test.com', 'testuser');
      expect(result).toBe(true);
    });

    it('should handle send failure gracefully', async () => {
      const nodemailer = require('nodemailer');
      nodemailer.createTransport.mockReturnValueOnce({
        sendMail: jest.fn().mockRejectedValue(new Error('SMTP error')),
      });

      // Recreate service with failing transporter
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      const failingService = module.get<EmailService>(EmailService);
      const result = await failingService.sendOtpEmail('user@test.com', '123');
      expect(result).toBe(false);
    });
  });

  describe('when not configured', () => {
    beforeEach(async () => {
      configService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should return true in mock mode for OTP email', async () => {
      const result = await service.sendOtpEmail('user@test.com', '123456');
      expect(result).toBe(true);
    });

    it('should return true in mock mode for 2FA OTP', async () => {
      const result = await service.send2FAOtpEmail('user@test.com', '123456');
      expect(result).toBe(true);
    });

    it('should return true in mock mode for welcome email', async () => {
      const result = await service.sendWelcomeEmail('user@test.com', 'user');
      expect(result).toBe(true);
    });
  });
});

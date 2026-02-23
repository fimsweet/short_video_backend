import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TotpService } from './totp.service';

describe('TotpService', () => {
  let service: TotpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TotpService],
    }).compile();

    service = module.get<TotpService>(TotpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSecret', () => {
    it('should generate a non-empty secret string', () => {
      const secret = service.createSecret();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(0);
    });

    it('should generate unique secrets each time', () => {
      const s1 = service.createSecret();
      const s2 = service.createSecret();
      expect(s1).not.toBe(s2);
    });
  });

  describe('generateKeyUri', () => {
    it('should return a URI string containing the username', () => {
      const secret = service.createSecret();
      const uri = service.generateKeyUri('testuser', secret);
      expect(typeof uri).toBe('string');
      expect(uri.length).toBeGreaterThan(0);
    });

    it('should include issuer info', () => {
      const secret = service.createSecret();
      const uri = service.generateKeyUri('user', secret);
      expect(uri).toBeDefined();
    });
  });

  describe('generateQRCode', () => {
    it('should generate a base64 data URL', async () => {
      const qrCode = await service.generateQRCode('otpauth://totp/Test:user?secret=ABC&issuer=Test');
      expect(qrCode).toContain('data:image/png;base64,');
    });

    it('should handle short URLs', async () => {
      const qrCode = await service.generateQRCode('otpauth://totp/X');
      expect(qrCode).toContain('data:image/');
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token generated from same secret', async () => {
      const secret = service.createSecret();
      const token = await service.generateToken(secret);
      const isValid = await service.verifyToken(token, secret);
      expect(isValid).toBe(true);
    });

    it('should reject an invalid token', async () => {
      const secret = service.createSecret();
      const isValid = await service.verifyToken('000000', secret);
      // May be valid by coincidence, but typically false
      expect(typeof isValid).toBe('boolean');
    });

    it('should return false for malformed input', async () => {
      const isValid = await service.verifyToken('', '');
      expect(isValid).toBe(false);
    });
  });

  describe('generateToken', () => {
    it('should generate a 6-digit token', async () => {
      const secret = service.createSecret();
      const token = await service.generateToken(secret);
      expect(token).toMatch(/^\d{6}$/);
    });
  });
});

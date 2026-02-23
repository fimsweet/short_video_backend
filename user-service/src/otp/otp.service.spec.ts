import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { OtpService } from './otp.service';
import { OtpCode } from '../entities/otp-code.entity';

describe('OtpService', () => {
  let service: OtpService;
  let mockRepo: any;

  beforeEach(async () => {
    mockRepo = {
      count: jest.fn(),
      update: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: 1, isUsed: false, attempts: 0 })),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: 1 })),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: getRepositoryToken(OtpCode), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOtp', () => {
    it('should generate a 6-digit OTP and save it', async () => {
      mockRepo.count.mockResolvedValue(0);
      mockRepo.update.mockResolvedValue({ affected: 1 });

      const code = await service.createOtp('test@email.com', 'registration');

      expect(code).toMatch(/^\d{6}$/);
      expect(mockRepo.count).toHaveBeenCalled();
      expect(mockRepo.update).toHaveBeenCalled();
      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });

  describe('UT-OTP-03: createOtp() rate limiting', () => {
    it('should throw BadRequestException when more than 5 OTPs requested', async () => {
      mockRepo.count.mockResolvedValue(5);

      await expect(service.createOtp('test@email.com', 'registration'))
        .rejects.toThrow(BadRequestException);
    });

    it('should successfully create OTP when under rate limit', async () => {
      mockRepo.count.mockResolvedValue(2);
      mockRepo.update.mockResolvedValue({ affected: 1 });

      const code = await service.createOtp('test@email.com', 'registration');
      expect(code).toMatch(/^\d{6}$/);
    });
  });

  describe('UT-OTP-04: createOtp() invalidates previous OTP', () => {
    it('should call update to invalidate previous unused OTPs before creating new one', async () => {
      mockRepo.count.mockResolvedValue(2);
      mockRepo.update.mockResolvedValue({ affected: 1 });

      await service.createOtp('+84123456789', '2fa');

      expect(mockRepo.update).toHaveBeenCalledWith(
        { phone: '+84123456789', purpose: '2fa', isUsed: false },
        { isUsed: true },
      );
    });
  });

  describe('verifyOtp', () => {
    it('should verify a valid OTP and mark as used', async () => {
      const otpEntity = { id: 1, phone: 'test@email.com', code: '123456', isUsed: false, attempts: 0 };
      mockRepo.findOne.mockResolvedValueOnce(otpEntity);
      mockRepo.save.mockResolvedValue({ ...otpEntity, isUsed: true });

      const result = await service.verifyOtp('test@email.com', '123456', 'registration');

      expect(result).toBe(true);
      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isUsed: true }));
    });

    it('should throw if OTP is already used', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(null) // valid OTP not found
        .mockResolvedValueOnce({ id: 1, isUsed: true, expiresAt: new Date(Date.now() + 60000) }); // expired check

      await expect(service.verifyOtp('test@email.com', '123456', 'registration'))
        .rejects.toThrow('Mã xác thực đã được sử dụng');
    });

    it('should throw if OTP is expired', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1, isUsed: false, expiresAt: new Date(Date.now() - 60000) });

      await expect(service.verifyOtp('test@email.com', '123456', 'registration'))
        .rejects.toThrow('Mã xác thực đã hết hạn');
    });

    it('should increment attempts on wrong OTP', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(null) // valid OTP not found
        .mockResolvedValueOnce(null) // no expired match either
        .mockResolvedValueOnce({ id: 1, attempts: 2, isUsed: false }); // for incrementAttempts

      await expect(service.verifyOtp('test@email.com', '000000', 'registration'))
        .rejects.toThrow('Mã xác thực không đúng');
    });

    it('should invalidate OTP after 5 failed attempts', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1, attempts: 4, isUsed: false });

      await expect(service.verifyOtp('test@email.com', '000000', 'registration'))
        .rejects.toThrow(BadRequestException);

      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ attempts: 5, isUsed: true }));
    });
  });

  describe('UT-OTP-01: verifyOtp() expiry enforcement', () => {
    it('should throw BadRequestException for expired OTP', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1, isUsed: false, expiresAt: new Date(Date.now() - 60000) });

      await expect(service.verifyOtp('test@email.com', '123456', 'registration'))
        .rejects.toThrow('Mã xác thực đã hết hạn');
    });
  });

  describe('cleanupExpiredOtps', () => {
    it('should delete expired OTPs', async () => {
      mockRepo.delete.mockResolvedValue({ affected: 3 });

      await service.cleanupExpiredOtps();

      expect(mockRepo.delete).toHaveBeenCalled();
    });
  });
});

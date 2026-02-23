import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseAdminService } from './firebase-admin.service';

// Define mocks INSIDE the factory to avoid hoisting issues
jest.mock('firebase-admin', () => {
  const _mockVerifyIdToken = jest.fn();
  return {
    apps: [{ name: 'default' }],
    app: jest.fn().mockReturnValue({ options: { projectId: 'test-project' } }),
    auth: jest.fn().mockReturnValue({
      verifyIdToken: _mockVerifyIdToken,
    }),
    credential: { cert: jest.fn() },
    initializeApp: jest.fn(),
    __mockVerifyIdToken: _mockVerifyIdToken,
  };
});

describe('FirebaseAdminService', () => {
  let service: FirebaseAdminService;
  let configService: any;
  let mockVerifyIdToken: jest.Mock;

  beforeEach(async () => {
    const admin = require('firebase-admin');
    mockVerifyIdToken = admin.__mockVerifyIdToken;

    configService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirebaseAdminService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<FirebaseAdminService>(FirebaseAdminService);
    mockVerifyIdToken.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verifyPhoneToken', () => {
    it('should verify token and return uid and phone', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'firebase-uid-123',
        phone_number: '+84123456789',
      });

      const result = await service.verifyPhoneToken('valid-id-token');
      expect(result.uid).toBe('firebase-uid-123');
      expect(result.phone).toBe('+84123456789');
    });

    it('should throw if token has no phone number', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'uid',
        phone_number: undefined,
      });

      await expect(service.verifyPhoneToken('token-no-phone')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on invalid token', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

      await expect(service.verifyPhoneToken('bad-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getAuth', () => {
    it('should return firebase auth instance', () => {
      const auth = service.getAuth();
      expect(auth).toBeDefined();
      expect(auth.verifyIdToken).toBeDefined();
    });
  });
});

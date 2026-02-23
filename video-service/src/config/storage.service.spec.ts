jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    PutObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    HeadObjectCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
    GetObjectCommand: jest.fn(),
    __mockSend: send,
  };
});

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    done: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock('fs', () => ({
  createReadStream: jest.fn().mockReturnValue('stream'),
  statSync: jest.fn().mockReturnValue({ size: 1024, isFile: () => true }),
  readFileSync: jest.fn().mockReturnValue(Buffer.from('data')),
  readdirSync: jest.fn().mockReturnValue([]),
}));

import { StorageService } from './storage.service';
import * as fs from 'fs';

describe('StorageService', () => {
  let service: StorageService;
  let mockSend: jest.Mock;

  const makeConfig = (overrides: Record<string, any> = {}) => ({
    get: jest.fn((key: string) => {
      const defaults: Record<string, any> = {
        AWS_ACCESS_KEY_ID: 'AKID',
        AWS_SECRET_ACCESS_KEY: 'SECRET',
        AWS_S3_BUCKET: 'my-bucket',
        AWS_REGION: 'ap-southeast-1',
        CLOUDFRONT_URL: '',
      };
      return key in overrides ? overrides[key] : defaults[key];
    }),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    const { __mockSend } = require('@aws-sdk/client-s3');
    mockSend = __mockSend;
    service = new StorageService(makeConfig() as any);
    await service.onModuleInit();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('onModuleInit', () => {
    it('should enable S3 when credentials provided', async () => {
      expect(service.isEnabled()).toBe(true);
    });

    it('should disable S3 when credentials missing', async () => {
      const svc = new StorageService(makeConfig({ AWS_ACCESS_KEY_ID: undefined }) as any);
      await svc.onModuleInit();
      expect(svc.isEnabled()).toBe(false);
    });

    it('should log CloudFront URL when configured', async () => {
      const svc = new StorageService(makeConfig({ CLOUDFRONT_URL: 'https://cdn.example.com' }) as any);
      await svc.onModuleInit();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('CloudFront'));
    });
  });

  describe('uploadFile', () => {
    it('should return local path when S3 disabled', async () => {
      const svc = new StorageService(makeConfig({ AWS_ACCESS_KEY_ID: undefined }) as any);
      await svc.onModuleInit();
      const result = await svc.uploadFile('/tmp/video.mp4', 'videos/v1.mp4');
      expect(result.bucket).toBe('local');
      expect(result.url).toContain('/uploads/');
    });

    it('should do simple upload for small files', async () => {
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 });
      mockSend.mockResolvedValue({});
      const result = await service.uploadFile('/tmp/video.mp4', 'videos/v1.mp4');
      expect(result.key).toBe('videos/v1.mp4');
      expect(result.bucket).toBe('my-bucket');
    });

    it('should use multipart upload for large files', async () => {
      (fs.statSync as jest.Mock).mockReturnValue({ size: 10 * 1024 * 1024 });
      const result = await service.uploadFile('/tmp/big.mp4', 'videos/big.mp4');
      expect(result.key).toBe('videos/big.mp4');
    });
  });

  describe('uploadBuffer', () => {
    it('should upload buffer to S3', async () => {
      mockSend.mockResolvedValue({});
      const result = await service.uploadBuffer(Buffer.from('data'), 'key.txt', 'text/plain');
      expect(result.key).toBe('key.txt');
    });

    it('should throw when S3 not enabled', async () => {
      const svc = new StorageService(makeConfig({ AWS_ACCESS_KEY_ID: undefined }) as any);
      await svc.onModuleInit();
      await expect(svc.uploadBuffer(Buffer.from('x'), 'k', 'text/plain')).rejects.toThrow('S3 not enabled');
    });
  });

  describe('uploadDirectory', () => {
    it('should upload all files in directory', async () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['a.ts', 'b.ts']);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 100, isFile: () => true });
      mockSend.mockResolvedValue({});
      const results = await service.uploadDirectory('/tmp/hls', 'hls/v1');
      expect(results).toHaveLength(2);
    });

    it('should skip subdirectories', async () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['dir1', 'file.ts']);
      (fs.statSync as jest.Mock)
        .mockReturnValueOnce({ isFile: () => false })
        .mockReturnValueOnce({ size: 100, isFile: () => true });
      mockSend.mockResolvedValue({});
      const results = await service.uploadDirectory('/tmp/hls', 'hls/v1');
      expect(results).toHaveLength(1);
    });
  });

  describe('deleteFile', () => {
    it('should delete from S3', async () => {
      mockSend.mockResolvedValue({});
      await service.deleteFile('key.mp4');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should no-op when S3 disabled', async () => {
      const svc = new StorageService(makeConfig({ AWS_ACCESS_KEY_ID: undefined }) as any);
      await svc.onModuleInit();
      await svc.deleteFile('key.mp4');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('deleteDirectory', () => {
    it('should delete all objects with prefix', async () => {
      mockSend
        .mockResolvedValueOnce({ Contents: [{ Key: 'hls/v1/a.ts' }, { Key: 'hls/v1/b.ts' }] })
        .mockResolvedValue({});
      await service.deleteDirectory('hls/v1');
      expect(mockSend).toHaveBeenCalledTimes(3); // list + 2 deletes
    });

    it('should handle empty directory', async () => {
      mockSend.mockResolvedValue({ Contents: null });
      await service.deleteDirectory('empty/');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should no-op when S3 disabled', async () => {
      const svc = new StorageService(makeConfig({ AWS_ACCESS_KEY_ID: undefined }) as any);
      await svc.onModuleInit();
      await svc.deleteDirectory('hls/v1');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('fileExists', () => {
    it('should return true when file exists', async () => {
      mockSend.mockResolvedValue({});
      expect(await service.fileExists('key.mp4')).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      mockSend.mockRejectedValue(new Error('NotFound'));
      expect(await service.fileExists('no.mp4')).toBe(false);
    });

    it('should return false when S3 disabled', async () => {
      const svc = new StorageService(makeConfig({ AWS_ACCESS_KEY_ID: undefined }) as any);
      await svc.onModuleInit();
      expect(await svc.fileExists('key.mp4')).toBe(false);
    });
  });

  describe('getPublicUrl', () => {
    it('should return S3 URL when no CloudFront', () => {
      expect(service.getPublicUrl('videos/v1.mp4')).toContain('s3.ap-southeast-1.amazonaws.com');
    });

    it('should return CloudFront URL when configured', async () => {
      const svc = new StorageService(makeConfig({ CLOUDFRONT_URL: 'https://cdn.example.com' }) as any);
      await svc.onModuleInit();
      expect(svc.getPublicUrl('videos/v1.mp4')).toBe('https://cdn.example.com/videos/v1.mp4');
    });
  });

  describe('getBucket / getCloudfrontUrl', () => {
    it('should return bucket', () => {
      expect(service.getBucket()).toBe('my-bucket');
    });

    it('should return cloudfront url', () => {
      expect(service.getCloudfrontUrl()).toBe('');
    });
  });
});

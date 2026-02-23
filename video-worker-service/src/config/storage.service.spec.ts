// ============================================
// Mock fs BEFORE imports to avoid path-scurry conflict
// ============================================
const mockExistsSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockStatSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockCreateReadStream = jest.fn();
const mockCreateWriteStream = jest.fn();
const mockWriteFileSync = jest.fn();

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  statSync: mockStatSync,
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
  createReadStream: mockCreateReadStream,
  createWriteStream: mockCreateWriteStream,
  writeFileSync: mockWriteFileSync,
}));

// Mock typeorm and @nestjs/typeorm to prevent path-scurry chain error
jest.mock('typeorm', () => ({
  Entity: () => () => {},
  PrimaryGeneratedColumn: () => () => {},
  Column: () => () => {},
  CreateDateColumn: () => () => {},
  UpdateDateColumn: () => () => {},
  Repository: class {},
  DataSource: class {},
}));
jest.mock('@nestjs/typeorm', () => ({
  TypeOrmModule: { forRoot: () => ({}), forFeature: () => ({}) },
  InjectRepository: () => () => {},
  getRepositoryToken: (entity: any) => `${entity?.name || 'Unknown'}Repository`,
}));

// Mock AWS SDK
const mockS3Send = jest.fn();
const mockUploadDone = jest.fn();
const mockUploadOn = jest.fn().mockReturnThis();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((params) => ({ ...params, _type: 'PutObject' })),
  DeleteObjectCommand: jest.fn((params) => ({ ...params, _type: 'DeleteObject' })),
  GetObjectCommand: jest.fn((params) => ({ ...params, _type: 'GetObject' })),
  HeadObjectCommand: jest.fn((params) => ({ ...params, _type: 'HeadObject' })),
}));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    on: mockUploadOn,
    done: mockUploadDone,
  })),
}));

import { StorageService } from './storage.service';
import { ConfigService } from '@nestjs/config';

describe('StorageService', () => {
  let service: StorageService;
  let configService: any;

  const mockConfigValues: Record<string, string> = {
    AWS_ACCESS_KEY_ID: 'test-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
    AWS_S3_BUCKET: 'test-bucket',
    AWS_REGION: 'ap-southeast-1',
    CLOUDFRONT_URL: 'https://cdn.example.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string) => mockConfigValues[key]),
    };

    service = new StorageService(configService as ConfigService);

    // Re-set fs mocks after clearAllMocks
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 1024, isDirectory: () => false, isFile: () => true });
    mockReadFileSync.mockReturnValue(Buffer.from('test-data'));
    mockCreateReadStream.mockReturnValue({ pipe: jest.fn() });
    mockReaddirSync.mockReturnValue([]);
  });

  describe('onModuleInit', () => {
    it('should initialize S3 when credentials are provided', async () => {
      await service.onModuleInit();
      expect(service.isEnabled()).toBe(true);
    });

    it('should not enable S3 when credentials are missing', async () => {
      const noAwsConfig = {
        get: jest.fn(() => undefined),
      };
      const localService = new StorageService(noAwsConfig as any);
      await localService.onModuleInit();
      expect(localService.isEnabled()).toBe(false);
    });

    it('should not enable S3 when bucket is missing', async () => {
      const noBucketConfig = {
        get: jest.fn((key: string) => {
          if (key === 'AWS_S3_BUCKET') return '';
          return 'some-value';
        }),
      };
      const localService = new StorageService(noBucketConfig as any);
      await localService.onModuleInit();
      expect(localService.isEnabled()).toBe(false);
    });
  });

  describe('isEnabled', () => {
    it('should return false before init', () => {
      expect(service.isEnabled()).toBe(false);
    });

    it('should return true after init with creds', async () => {
      await service.onModuleInit();
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('uploadFile', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should use multipart upload for files > 5MB', async () => {
      mockStatSync.mockReturnValue({ size: 10 * 1024 * 1024 }); // 10MB
      mockUploadDone.mockResolvedValue({});

      const result = await service.uploadFile('/path/to/file.mp4', 'videos/test.mp4');
      expect(result.key).toBe('videos/test.mp4');
      expect(result.url).toContain('videos/test.mp4');
      expect(result.bucket).toBe('test-bucket');
    });

    it('should use PutObjectCommand for files <= 5MB', async () => {
      mockStatSync.mockReturnValue({ size: 1024 }); // 1KB
      mockS3Send.mockResolvedValue({});

      const result = await service.uploadFile('/path/to/file.ts', 'videos/seg.ts');
      expect(result.key).toBe('videos/seg.ts');
      expect(mockS3Send).toHaveBeenCalled();
    });

    it('should return local path when S3 is not enabled', async () => {
      const localService = new StorageService({ get: jest.fn(() => undefined) } as any);
      await localService.onModuleInit();

      const result = await localService.uploadFile('/path/file.mp4', 'key.mp4');
      expect(result.bucket).toBe('local');
      expect(result.url).toContain('/uploads/processed_videos/');
    });

    it('should use custom contentType when provided', async () => {
      mockStatSync.mockReturnValue({ size: 1024 });
      mockS3Send.mockResolvedValue({});

      await service.uploadFile('/path/to/file.m3u8', 'key.m3u8', 'application/vnd.apple.mpegurl');
      expect(mockS3Send).toHaveBeenCalled();
    });
  });

  describe('uploadProcessedVideo', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should upload all files and return HLS + thumbnail URLs', async () => {
      mockReaddirSync.mockReturnValue(['master.m3u8', 'thumbnail.jpg']);
      mockStatSync.mockImplementation((p: string) => ({
        size: 1024,
        isDirectory: () => false,
        isFile: () => true,
      }));
      mockS3Send.mockResolvedValue({});

      const result = await service.uploadProcessedVideo('/output/dir', 'video-123');
      expect(result).toHaveProperty('hlsUrl');
      expect(result).toHaveProperty('thumbnailUrl');
    });

    it('should return local paths when S3 is disabled', async () => {
      const localService = new StorageService({ get: jest.fn(() => undefined) } as any);
      await localService.onModuleInit();

      mockReaddirSync.mockReturnValue([]);

      const result = await localService.uploadProcessedVideo('/output/testdir', 'video-123');
      expect(result.hlsUrl).toContain('playlist.m3u8');
      expect(result.thumbnailUrl).toContain('thumbnail.jpg');
    });
  });

  describe('downloadFile', () => {
    it('should throw when S3 is not enabled', async () => {
      const localService = new StorageService({ get: jest.fn(() => undefined) } as any);
      await localService.onModuleInit();

      await expect(localService.downloadFile('key', '/local/path')).rejects.toThrow('S3 not enabled');
    });

    it('should create parent directory if not exists', async () => {
      await service.onModuleInit();
      mockExistsSync.mockReturnValue(false);

      const mockPipe = jest.fn();
      const mockWriteStream = {
        on: jest.fn((event, cb) => {
          if (event === 'finish') setTimeout(cb, 0);
          return mockWriteStream;
        }),
      };
      const mockBody = {
        pipe: mockPipe,
        on: jest.fn().mockReturnThis(),
      };

      mockS3Send.mockResolvedValue({ Body: mockBody });
      mockCreateWriteStream.mockReturnValue(mockWriteStream);
      mockStatSync.mockReturnValue({ size: 2048 });

      await service.downloadFile('raw_videos/test.mp4', '/local/path/test.mp4');
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });
  });

  describe('deleteFile', () => {
    it('should delete file from S3', async () => {
      await service.onModuleInit();
      mockS3Send.mockResolvedValue({});

      await service.deleteFile('key-to-delete');
      expect(mockS3Send).toHaveBeenCalled();
    });

    it('should do nothing when S3 is not enabled', async () => {
      const localService = new StorageService({ get: jest.fn(() => undefined) } as any);
      await localService.onModuleInit();

      await localService.deleteFile('any-key'); // should not throw
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should handle delete errors gracefully', async () => {
      await service.onModuleInit();
      mockS3Send.mockRejectedValue(new Error('delete failed'));

      await expect(service.deleteFile('key')).resolves.toBeUndefined();
    });
  });

  describe('fileExists', () => {
    it('should return true when file exists in S3', async () => {
      await service.onModuleInit();
      mockS3Send.mockResolvedValue({});

      const exists = await service.fileExists('videos/test.mp4');
      expect(exists).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      await service.onModuleInit();
      mockS3Send.mockRejectedValue(new Error('NotFound'));

      const exists = await service.fileExists('videos/missing.mp4');
      expect(exists).toBe(false);
    });

    it('should return false when S3 is not enabled', async () => {
      const localService = new StorageService({ get: jest.fn(() => undefined) } as any);
      await localService.onModuleInit();

      const exists = await localService.fileExists('any-key');
      expect(exists).toBe(false);
    });
  });

  describe('deleteProcessedVideo', () => {
    it('should log deletion message when S3 is enabled', async () => {
      await service.onModuleInit();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await service.deleteProcessedVideo('vid-123');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('vid-123'));
      consoleSpy.mockRestore();
    });

    it('should do nothing when S3 is not enabled', async () => {
      const localService = new StorageService({ get: jest.fn(() => undefined) } as any);
      await localService.onModuleInit();

      await localService.deleteProcessedVideo('vid-123'); // should not throw
    });
  });

  describe('getPublicUrl', () => {
    it('should return CloudFront URL when configured', async () => {
      await service.onModuleInit();
      const url = service.getPublicUrl('videos/test.mp4');
      expect(url).toBe('https://cdn.example.com/videos/test.mp4');
    });

    it('should return S3 URL when no CloudFront', async () => {
      const noCfConfig = {
        get: jest.fn((key: string) => {
          const vals: Record<string, string> = {
            ...mockConfigValues,
            CLOUDFRONT_URL: '',
          };
          return vals[key];
        }),
      };
      const svc = new StorageService(noCfConfig as any);
      await svc.onModuleInit();
      const url = svc.getPublicUrl('videos/test.mp4');
      expect(url).toContain('s3.');
      expect(url).toContain('test-bucket');
      expect(url).toContain('videos/test.mp4');
    });
  });

  describe('getBucket', () => {
    it('should return the bucket name', async () => {
      await service.onModuleInit();
      expect(service.getBucket()).toBe('test-bucket');
    });
  });

  describe('getCloudfrontUrl', () => {
    it('should return the CloudFront URL', async () => {
      await service.onModuleInit();
      expect(service.getCloudfrontUrl()).toBe('https://cdn.example.com');
    });
  });
});

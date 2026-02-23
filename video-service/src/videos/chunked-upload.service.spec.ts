jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({
    write: jest.fn(),
    end: jest.fn((cb) => cb && cb(null)),
  }),
  statSync: jest.fn().mockReturnValue({ size: 1024 }),
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(Buffer.from('chunk')),
    rm: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('test-uuid') }));

import { ChunkedUploadService } from './chunked-upload.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';

describe('ChunkedUploadService', () => {
  let service: ChunkedUploadService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    // Need to suppress setInterval during construction
    jest.useFakeTimers();
    const config = { get: jest.fn().mockReturnValue('./uploads/temp_chunks') };
    service = new ChunkedUploadService(config as any);
    jest.useRealTimers();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('initUpload', () => {
    it('should create upload session and return id', () => {
      const id = service.initUpload('video.mp4', 10485760, 2, 'u1', 'My Video', 'desc');
      expect(id).toBe('test-uuid');
    });

    it('should create temp directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      service.initUpload('video.mp4', 5000000, 1, 'u1', 'Title');
      expect(fs.mkdirSync).toHaveBeenCalled();
    });
  });

  describe('uploadChunk', () => {
    it('should save chunk and track progress', async () => {
      service.initUpload('video.mp4', 10000, 2, 'u1', 'Title');
      const result = await service.uploadChunk('test-uuid', 0, Buffer.from('data'));
      expect(result.uploadedChunks).toBe(1);
      expect(result.totalChunks).toBe(2);
    });

    it('should throw NotFoundException for unknown upload', async () => {
      await expect(service.uploadChunk('unknown', 0, Buffer.from('x')))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException on write failure', async () => {
      service.initUpload('video.mp4', 10000, 2, 'u1', 'Title');
      (fs.promises.writeFile as jest.Mock).mockRejectedValueOnce(new Error('disk'));
      await expect(service.uploadChunk('test-uuid', 0, Buffer.from('x')))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('completeUpload', () => {
    it('should merge chunks and return file path', async () => {
      service.initUpload('video.mp4', 2000, 2, 'u1', 'Title', 'desc');
      // Simulate uploading both chunks
      await service.uploadChunk('test-uuid', 0, Buffer.from('chunk0'));
      await service.uploadChunk('test-uuid', 1, Buffer.from('chunk1'));
      const result = await service.completeUpload('test-uuid');
      expect(result.filePath).toContain('raw_videos');
      expect(result.metadata.userId).toBe('u1');
    });

    it('should throw NotFoundException for unknown upload', async () => {
      await expect(service.completeUpload('unknown')).rejects.toThrow(NotFoundException);
    });

    it('should throw if missing chunks', async () => {
      service.initUpload('video.mp4', 2000, 2, 'u1', 'Title');
      await service.uploadChunk('test-uuid', 0, Buffer.from('chunk0'));
      await expect(service.completeUpload('test-uuid')).rejects.toThrow(BadRequestException);
    });

    it('should handle merge failure', async () => {
      service.initUpload('video.mp4', 1000, 1, 'u1', 'Title');
      await service.uploadChunk('test-uuid', 0, Buffer.from('data'));
      (fs.promises.readFile as jest.Mock).mockRejectedValueOnce(new Error('read error'));
      await expect(service.completeUpload('test-uuid')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getUploadStatus', () => {
    it('should return status', () => {
      service.initUpload('video.mp4', 2000, 3, 'u1', 'Title');
      const status = service.getUploadStatus('test-uuid');
      expect(status.totalChunks).toBe(3);
      expect(status.uploadedChunks).toBe(0);
    });

    it('should throw NotFoundException for unknown upload', () => {
      expect(() => service.getUploadStatus('unknown')).toThrow(NotFoundException);
    });
  });
});

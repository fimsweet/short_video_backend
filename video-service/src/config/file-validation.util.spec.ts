/* eslint-disable @typescript-eslint/no-require-imports */
const mockExistsSync = jest.fn();
const mockOpenSync = jest.fn();
const mockReadSync = jest.fn();
const mockCloseSync = jest.fn();
const mockUnlinkSync = jest.fn();

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  openSync: mockOpenSync,
  readSync: mockReadSync,
  closeSync: mockCloseSync,
  unlinkSync: mockUnlinkSync,
}));

import { validateVideoFile, validateImageFile, deleteInvalidFile } from './file-validation.util';

describe('file-validation.util', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  const setupHeaderMock = (headerBytes: number[]) => {
    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(99);
    mockCloseSync.mockImplementation(() => {});
    mockReadSync.mockImplementation((_fd: number, buf: Buffer) => {
      const src = Buffer.from(headerBytes);
      src.copy(buf);
      return src.length;
    });
  };

  describe('validateVideoFile', () => {
    it('should validate MP4 file (ftyp at offset 4)', async () => {
      setupHeaderMock([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
      const result = await validateVideoFile('/tmp/video.mp4');
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('video/mp4');
    });

    it('should validate WebM file', async () => {
      setupHeaderMock([0x1A, 0x45, 0xDF, 0xA3]);
      const result = await validateVideoFile('/tmp/video.webm');
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('video/webm');
    });

    it('should validate AVI file (RIFF)', async () => {
      setupHeaderMock([0x52, 0x49, 0x46, 0x46]);
      const result = await validateVideoFile('/tmp/video.avi');
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('video/x-msvideo');
    });

    it('should reject invalid file', async () => {
      setupHeaderMock([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const result = await validateVideoFile('/tmp/fake.mp4');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('valid video signature');
    });

    it('should reject non-existent file', async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await validateVideoFile('/tmp/missing.mp4');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('File not found');
    });

    it('should handle read error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockOpenSync.mockImplementation(() => {
        throw new Error('permission denied');
      });
      const result = await validateVideoFile('/tmp/locked.mp4');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('permission denied');
    });
  });

  describe('validateImageFile', () => {
    it('should validate JPEG file', async () => {
      setupHeaderMock([0xFF, 0xD8, 0xFF]);
      const result = await validateImageFile('/tmp/img.jpg');
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('image/jpeg');
    });

    it('should validate PNG file', async () => {
      setupHeaderMock([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const result = await validateImageFile('/tmp/img.png');
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('image/png');
    });

    it('should validate GIF file', async () => {
      setupHeaderMock([0x47, 0x49, 0x46, 0x38]);
      const result = await validateImageFile('/tmp/img.gif');
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('image/gif');
    });

    it('should validate WebP file', async () => {
      const header = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
      setupHeaderMock(header);
      const result = await validateImageFile('/tmp/img.webp');
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('image/webp');
    });

    it('should reject RIFF file without WEBP marker', async () => {
      const header = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20];
      setupHeaderMock(header);
      const result = await validateImageFile('/tmp/file.avi');
      expect(result.isValid).toBe(false);
    });

    it('should reject invalid image', async () => {
      setupHeaderMock([0x00, 0x00, 0x00, 0x00]);
      const result = await validateImageFile('/tmp/fake.jpg');
      expect(result.isValid).toBe(false);
    });

    it('should reject non-existent file', async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await validateImageFile('/tmp/missing.png');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('File not found');
    });

    it('should handle read error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockOpenSync.mockImplementation(() => {
        throw new Error('IO error');
      });
      const result = await validateImageFile('/tmp/locked.png');
      expect(result.isValid).toBe(false);
    });
  });

  describe('deleteInvalidFile', () => {
    it('should delete existing file', () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {});
      deleteInvalidFile('/tmp/bad.mp4');
      expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/bad.mp4');
    });

    it('should skip non-existent file', () => {
      mockExistsSync.mockReturnValue(false);
      deleteInvalidFile('/tmp/gone.mp4');
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('should handle deletion error gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('busy');
      });
      deleteInvalidFile('/tmp/busy.mp4');
      expect(console.error).toHaveBeenCalled();
    });
  });
});

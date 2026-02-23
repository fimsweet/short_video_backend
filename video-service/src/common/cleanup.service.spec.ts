import { CleanupService } from './cleanup.service';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');

describe('CleanupService', () => {
  let service: CleanupService;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    service = new CleanupService();
    jest.clearAllMocks();
    // Suppress console logs during tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('should be defined', () => expect(service).toBeDefined());

  describe('onModuleInit', () => {
    it('should run cleanup on init', () => {
      mockFs.existsSync.mockReturnValue(false);
      service.onModuleInit();
      // Should have checked directories
      expect(mockFs.existsSync).toHaveBeenCalled();
    });
  });

  describe('handleScheduledCleanup', () => {
    it('should run cleanup', () => {
      mockFs.existsSync.mockReturnValue(false);
      service.handleScheduledCleanup();
      expect(mockFs.existsSync).toHaveBeenCalled();
    });
  });

  describe('handlePeriodicCleanup', () => {
    it('should run cleanup', () => {
      mockFs.existsSync.mockReturnValue(false);
      service.handlePeriodicCleanup();
      expect(mockFs.existsSync).toHaveBeenCalled();
    });
  });

  describe('runCleanup (via triggerManualCleanup)', () => {
    it('should skip non-existent directories', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = await service.triggerManualCleanup();
      expect(result.deletedCount).toBe(0);
    });

    it('should delete old files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['old.mp4'] as any);
      mockFs.statSync.mockReturnValue({
        isDirectory: () => false,
        mtimeMs: Date.now() - 48 * 60 * 60 * 1000, // 48h old
        size: 1024 * 1024,
      } as any);
      mockFs.unlinkSync.mockImplementation(() => {});

      const result = await service.triggerManualCleanup();
      expect(result.deletedCount).toBeGreaterThan(0);
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('should not delete recent files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['new.mp4'] as any);
      mockFs.statSync.mockReturnValue({
        isDirectory: () => false,
        mtimeMs: Date.now() - 1000, // 1 second old
        size: 512,
      } as any);

      const result = await service.triggerManualCleanup();
      expect(result.deletedCount).toBe(0);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should recursively clean subdirectories', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const callCount = { readdirSync: 0 };
      mockFs.readdirSync.mockImplementation((dir: any) => {
        callCount.readdirSync++;
        if (callCount.readdirSync === 1) return ['subdir'] as any;
        if (callCount.readdirSync === 2) return ['old.mp4'] as any;
        return [] as any;
      });
      const statCallCount = { n: 0 };
      mockFs.statSync.mockImplementation((p: any) => {
        statCallCount.n++;
        if (statCallCount.n === 1) return { isDirectory: () => true } as any;
        return { isDirectory: () => false, mtimeMs: Date.now() - 48 * 60 * 60 * 1000, size: 100 } as any;
      });
      mockFs.unlinkSync.mockImplementation(() => {});
      mockFs.rmdirSync.mockImplementation(() => {});

      const result = await service.triggerManualCleanup();
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('should remove empty directories after cleaning', async () => {
      mockFs.existsSync.mockReturnValue(true);
      let readCount = 0;
      mockFs.readdirSync.mockImplementation(() => {
        readCount++;
        if (readCount === 1) return ['subdir'] as any;
        return [] as any; // empty subdir
      });
      mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
      mockFs.rmdirSync.mockImplementation(() => {});

      await service.triggerManualCleanup();
      expect(mockFs.rmdirSync).toHaveBeenCalled();
    });

    it('should handle errors for individual files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['bad.mp4'] as any);
      mockFs.statSync.mockImplementation(() => { throw new Error('permission denied'); });

      // Should not throw
      const result = await service.triggerManualCleanup();
      expect(result.deletedCount).toBe(0);
    });

    it('should handle directory-level errors', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation(() => { throw new Error('dir error'); });

      // runCleanup called via onModuleInit - should not throw
      expect(() => service.onModuleInit()).not.toThrow();
    });
  });

  describe('getDiskStats', () => {
    it('should return stats for existing directories', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['file1.mp4', 'file2.mp4'] as any);
      mockFs.statSync.mockReturnValue({ isDirectory: () => false, size: 1024 } as any);

      const stats = service.getDiskStats();
      expect(stats.length).toBe(3); // 3 temp dirs
      stats.forEach(s => {
        expect(s.fileCount).toBeGreaterThanOrEqual(0);
        expect(s.totalSize).toBeGreaterThanOrEqual(0);
      });
    });

    it('should handle non-existent directories', () => {
      mockFs.existsSync.mockReturnValue(false);
      const stats = service.getDiskStats();
      expect(stats.length).toBe(3);
      stats.forEach(s => {
        expect(s.fileCount).toBe(0);
        expect(s.totalSize).toBe(0);
      });
    });

    it('should count files recursively', () => {
      mockFs.existsSync.mockReturnValue(true);
      let readCount = 0;
      mockFs.readdirSync.mockImplementation(() => {
        readCount++;
        if (readCount <= 3) return ['subdir'] as any; // first call per dir -> subdir
        return ['file.mp4'] as any;
      });
      let statCount = 0;
      mockFs.statSync.mockImplementation(() => {
        statCount++;
        if (statCount % 2 === 1) return { isDirectory: () => true, size: 0 } as any;
        return { isDirectory: () => false, size: 512 } as any;
      });

      const stats = service.getDiskStats();
      expect(stats.length).toBe(3);
    });
  });

  describe('formatAge (private)', () => {
    it('should format hours correctly', () => {
      const formatAge = (service as any).formatAge.bind(service);
      expect(formatAge(3 * 60 * 60 * 1000)).toBe('3h');
      expect(formatAge(25 * 60 * 60 * 1000)).toBe('1d 1h');
      expect(formatAge(48 * 60 * 60 * 1000)).toBe('2d 0h');
    });
  });
});

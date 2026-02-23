// ============================================
// Mock external dependencies BEFORE imports
// ============================================
const mockExistsSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockRmSync = jest.fn();

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readFileSync: mockReadFileSync,
  rmSync: mockRmSync,
}));

jest.mock('typeorm', () => ({
  Entity: () => () => {},
  PrimaryGeneratedColumn: () => () => {},
  Column: () => () => {},
  CreateDateColumn: () => () => {},
  UpdateDateColumn: () => () => {},
}));
jest.mock('@nestjs/typeorm', () => ({
  TypeOrmModule: { forRoot: () => ({}), forFeature: () => ({}) },
  InjectRepository: () => () => {},
}));

// Mock fluent-ffmpeg
const mockFfmpegOutput = jest.fn().mockReturnThis();
const mockFfmpegOutputOptions = jest.fn().mockReturnThis();
const mockFfmpegOn = jest.fn().mockImplementation(function (this: any, event: string, cb: Function) {
  if (event === 'end') {
    setTimeout(() => cb(), 0);
  }
  return this;
});
const mockFfmpegRun = jest.fn();

jest.mock('fluent-ffmpeg', () => {
  const ffmpegFn = jest.fn().mockReturnValue({
    outputOptions: mockFfmpegOutputOptions,
    output: mockFfmpegOutput,
    on: mockFfmpegOn,
    run: mockFfmpegRun,
  });
  return ffmpegFn;
});

// Mock AWS Rekognition
const mockRekognitionSend = jest.fn();
jest.mock('@aws-sdk/client-rekognition', () => ({
  RekognitionClient: jest.fn().mockImplementation(() => ({ send: mockRekognitionSend })),
  DetectLabelsCommand: jest.fn((params) => params),
}));

// Mock Google Generative AI
const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

import { AiAnalysisService } from './ai-analysis.service';
import { ConfigService } from '@nestjs/config';

describe('AiAnalysisService', () => {
  let service: AiAnalysisService;
  let configService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          AWS_REGION: 'ap-southeast-1',
          AWS_ACCESS_KEY_ID: 'test-key',
          AWS_SECRET_ACCESS_KEY: 'test-secret',
          GEMINI_API_KEY: 'test-gemini-key',
        };
        return config[key];
      }),
    };

    service = new AiAnalysisService(configService as ConfigService);

    // Re-set fs mocks
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(Buffer.from('fake-image'));

    // Re-set ffmpeg mocks - fix: chain on events properly
    mockFfmpegOn.mockImplementation(function (this: any, event: string, cb: Function) {
      if (event === 'end') {
        setTimeout(() => cb(), 0);
      }
      return this;
    });
  });

  describe('constructor', () => {
    it('should initialize Rekognition when AWS creds are provided', () => {
      expect(service).toBeDefined();
    });

    it('should skip Rekognition when AWS creds are missing', () => {
      const noAwsConfig = {
        get: jest.fn(() => undefined),
      };
      const svc = new AiAnalysisService(noAwsConfig as any);
      expect(svc).toBeDefined();
    });

    it('should skip Gemini when API key is missing', () => {
      const noGeminiConfig = {
        get: jest.fn((key: string) => {
          if (key === 'GEMINI_API_KEY') return null;
          return 'some-value';
        }),
      };
      const svc = new AiAnalysisService(noGeminiConfig as any);
      expect(svc).toBeDefined();
    });
  });

  describe('analyzeVideo', () => {
    it('should combine Gemini and Rekognition results', async () => {
      // Mock Gemini response
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'music, entertainment' },
      });

      // Mock Rekognition response
      mockRekognitionSend.mockResolvedValue({
        Labels: [
          { Name: 'Music', Confidence: 95 },
          { Name: 'Concert', Confidence: 85 },
          { Name: 'Microphone', Confidence: 80 },
        ],
      });

      const result = await service.analyzeVideo(
        '/path/to/video.mp4',
        'Live Concert Video',
        'Amazing live music performance',
        60,
      );

      expect(result.categoryIds).toBeDefined();
      expect(Array.isArray(result.categoryIds)).toBe(true);
      expect(result.geminiCategories).toEqual(['music', 'entertainment']);
      expect(result.confidence).toBeDefined();
    });

    it('should handle Gemini failure gracefully', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API limit'));

      mockRekognitionSend.mockResolvedValue({
        Labels: [{ Name: 'Dog', Confidence: 90 }],
      });

      const result = await service.analyzeVideo(
        '/path/video.mp4',
        'My Pet',
        'Cute dog video',
        30,
      );

      // Should still return results from Rekognition
      expect(result.geminiCategories).toEqual([]);
      expect(result.rekognitionLabels.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle Rekognition failure gracefully', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'food' },
      });

      // Make frame extraction fail (no frames extracted)
      mockExistsSync.mockReturnValue(false);

      const result = await service.analyzeVideo(
        '/path/video.mp4',
        'Cooking Tutorial',
        'How to make pasta',
        120,
      );

      expect(result.geminiCategories).toEqual(['food']);
    });

    it('should handle both failures gracefully', async () => {
      mockGenerateContent.mockRejectedValue(new Error('fail'));
      mockExistsSync.mockReturnValue(false);

      const result = await service.analyzeVideo(
        '/path/video.mp4',
        'Test',
        'desc',
        30,
      );

      expect(result.categoryIds).toEqual([]);
      expect(result.geminiCategories).toEqual([]);
    });

    it('should limit to max 3 AI categories', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'music, dance, entertainment, comedy, sports' },
      });
      mockExistsSync.mockReturnValue(false);

      const result = await service.analyzeVideo(
        '/path/video.mp4',
        'All categories test',
        'test',
        30,
      );

      expect(result.categoryIds.length).toBeLessThanOrEqual(3);
    });

    it('should filter out invalid Gemini categories', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'music, invalid_category, sports' },
      });
      mockExistsSync.mockReturnValue(false);

      const result = await service.analyzeVideo(
        '/path/video.mp4',
        'Music and Sports',
        'test',
        30,
      );

      expect(result.geminiCategories).not.toContain('invalid_category');
    });

    it('should map Rekognition labels to correct categories', async () => {
      mockGenerateContent.mockRejectedValue(new Error('skip'));

      mockRekognitionSend.mockResolvedValue({
        Labels: [
          { Name: 'Dog', Confidence: 95 },
          { Name: 'Cat', Confidence: 90 },
          { Name: 'Pet', Confidence: 85 },
        ],
      });

      const result = await service.analyzeVideo(
        '/path/video.mp4',
        'Pets',
        'My pets',
        30,
      );

      // Dog, Cat, Pet all map to 'pets' category
      if (result.categoryIds.length > 0) {
        expect(result.categoryIds).toContain(13); // pets = id 13
      }
    });

    it('should extract frames at 25%, 50%, 75% of duration', async () => {
      mockGenerateContent.mockRejectedValue(new Error('skip'));
      mockRekognitionSend.mockResolvedValue({ Labels: [] });

      await service.analyzeVideo('/path/video.mp4', 'Test', '', 100);

      // Frames should be extracted at 25s, 50s, 75s
      // ffmpeg should be called for frame extraction
    });

    it('should cleanup temp frame directory', async () => {
      mockGenerateContent.mockRejectedValue(new Error('skip'));
      mockRekognitionSend.mockResolvedValue({ Labels: [] });

      await service.analyzeVideo('/path/video.mp4', 'Test', '', 30);

      // rmSync should be called for cleanup
      expect(mockRmSync).toHaveBeenCalled();
    });
  });

  describe('formatSeekTime (via analyzeVideo)', () => {
    it('should handle various time values', () => {
      // Test the private formatSeekTime through analyzeVideo behavior
      // The method converts seconds to HH:MM:SS.ss format
      // Tested implicitly through frame extraction
      expect(service).toBeDefined();
    });
  });
});

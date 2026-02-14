import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RekognitionClient, DetectLabelsCommand } from '@aws-sdk/client-rekognition';
import * as fs from 'fs';
import * as path from 'path';

const ffmpeg = require('fluent-ffmpeg');

// ============================================
// CATEGORY DEFINITIONS (must match video-service categories)
// ============================================
const CATEGORIES = [
  { id: 1, name: 'entertainment' },
  { id: 2, name: 'music' },
  { id: 3, name: 'dance' },
  { id: 4, name: 'comedy' },
  { id: 5, name: 'food' },
  { id: 6, name: 'travel' },
  { id: 7, name: 'sports' },
  { id: 8, name: 'education' },
  { id: 9, name: 'gaming' },
  { id: 10, name: 'beauty' },
  { id: 11, name: 'fashion' },
  { id: 12, name: 'technology' },
  { id: 13, name: 'pets' },
  { id: 14, name: 'lifestyle' },
  { id: 15, name: 'news' },
];

// ============================================
// REKOGNITION LABEL → CATEGORY MAPPING
// ============================================
// Maps AWS Rekognition DetectLabels results to our categories
// Each Rekognition label maps to one or more category names
// ============================================
const REKOGNITION_LABEL_MAP: Record<string, string[]> = {
  // Music
  'Music': ['music'], 'Musical Instrument': ['music'], 'Guitar': ['music'],
  'Piano': ['music'], 'Microphone': ['music'], 'Concert': ['music', 'entertainment'],
  'Drum': ['music'], 'Violin': ['music'], 'Singing': ['music'],
  'DJ': ['music', 'entertainment'], 'Headphones': ['music'],

  // Dance
  'Dance': ['dance', 'entertainment'], 'Dancing': ['dance'], 'Ballet': ['dance'],

  // Food & Cooking
  'Food': ['food'], 'Cooking': ['food'], 'Kitchen': ['food'], 'Meal': ['food'],
  'Restaurant': ['food'], 'Pizza': ['food'], 'Fruit': ['food'], 'Vegetable': ['food'],
  'Dessert': ['food'], 'Cake': ['food'], 'Sushi': ['food'], 'Bread': ['food'],
  'Chef': ['food'], 'Baking': ['food'], 'Dining Room': ['food'],

  // Travel
  'Landscape': ['travel'], 'Beach': ['travel'], 'Mountain': ['travel'],
  'Nature': ['travel', 'lifestyle'], 'Architecture': ['travel'],
  'City': ['travel'], 'Tourism': ['travel'], 'Hotel': ['travel'],
  'Scenery': ['travel'], 'Lake': ['travel'], 'Ocean': ['travel'],
  'Sunset': ['travel', 'lifestyle'], 'Forest': ['travel'],

  // Sports
  'Sport': ['sports'], 'Football': ['sports'], 'Basketball': ['sports'],
  'Soccer': ['sports'], 'Tennis': ['sports'], 'Exercise': ['sports', 'lifestyle'],
  'Gym': ['sports', 'lifestyle'], 'Fitness': ['sports', 'lifestyle'],
  'Swimming': ['sports'], 'Running': ['sports'], 'Yoga': ['sports', 'lifestyle'],
  'Martial Arts': ['sports'], 'Boxing': ['sports'], 'Cycling': ['sports'],
  'Ball': ['sports'], 'Stadium': ['sports'],

  // Education
  'Classroom': ['education'], 'Whiteboard': ['education'], 'Book': ['education'],
  'School': ['education'], 'Writing': ['education'], 'Library': ['education'],
  'Lecture': ['education'], 'Student': ['education'], 'Teacher': ['education'],
  'Text': ['education'], 'Diagram': ['education'],

  // Gaming
  'Video Game': ['gaming'], 'Controller': ['gaming'],
  'Arcade': ['gaming'], 'Game': ['gaming', 'entertainment'],

  // Beauty
  'Makeup': ['beauty'], 'Cosmetics': ['beauty'], 'Lipstick': ['beauty'],
  'Skin Care': ['beauty'], 'Nail': ['beauty'], 'Mirror': ['beauty', 'lifestyle'],

  // Fashion
  'Fashion': ['fashion'], 'Clothing': ['fashion'], 'Dress': ['fashion'],
  'Model': ['fashion'], 'Runway': ['fashion'], 'Shopping': ['fashion', 'lifestyle'],
  'Jewelry': ['fashion'], 'Shoe': ['fashion'], 'Handbag': ['fashion'],
  'Sunglasses': ['fashion'],

  // Technology
  'Computer': ['technology'], 'Robot': ['technology'], 'Electronics': ['technology'],
  'Laptop': ['technology'], 'Monitor': ['technology'], 'Phone': ['technology'],
  'Software': ['technology'], 'Hardware': ['technology'], 'Tablet Computer': ['technology'],
  'Drone': ['technology'],

  // Pets & Animals
  'Dog': ['pets'], 'Cat': ['pets'], 'Pet': ['pets'], 'Animal': ['pets'],
  'Puppy': ['pets'], 'Kitten': ['pets'], 'Bird': ['pets'], 'Fish': ['pets'],
  'Rabbit': ['pets'], 'Hamster': ['pets'], 'Horse': ['pets'],
  'Wildlife': ['pets'], 'Aquarium': ['pets'],

  // Lifestyle
  'Home': ['lifestyle'], 'Interior Design': ['lifestyle'], 'Meditation': ['lifestyle'],
  'Spa': ['lifestyle'], 'Garden': ['lifestyle'], 'Family': ['lifestyle'],
  'Wedding': ['lifestyle', 'entertainment'], 'Baby': ['lifestyle'],
  'Coffee': ['lifestyle', 'food'], 'DIY': ['lifestyle'],

  // Entertainment (catch-all for performative content)
  'Performance': ['entertainment'], 'Show': ['entertainment'],
  'Television': ['entertainment'], 'Stage': ['entertainment'],
  'Audience': ['entertainment'], 'Celebrity': ['entertainment'],
  'Comedy': ['comedy', 'entertainment'], 'Movie': ['entertainment'],
  'Theater': ['entertainment'], 'Circus': ['entertainment'],
  'Party': ['entertainment', 'lifestyle'],

  // News
  'News': ['news'], 'Reporter': ['news'], 'Interview': ['news'],
  'Press': ['news'], 'Protest': ['news'], 'Politics': ['news'],
};

export interface AiCategoryResult {
  categoryIds: number[];
  geminiCategories: string[];
  rekognitionLabels: string[];
  confidence: Record<string, number>; // category name → confidence score
}

@Injectable()
export class AiAnalysisService {
  private rekognitionClient: RekognitionClient | null = null;
  private geminiApiKey: string | null = null;

  constructor(private configService: ConfigService) {
    // Initialize Rekognition client
    const region = this.configService.get<string>('AWS_REGION') || 'ap-southeast-1';
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    if (accessKeyId && secretAccessKey) {
      this.rekognitionClient = new RekognitionClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      console.log(`[AI] AWS Rekognition client initialized (region: ${region})`);
    } else {
      console.warn(`[AI] AWS credentials not found - Rekognition will be disabled`);
    }

    // Initialize Gemini
    this.geminiApiKey = this.configService.get<string>('GEMINI_API_KEY') || null;
    if (this.geminiApiKey) {
      console.log(`[AI] Gemini API key configured`);
    } else {
      console.warn(`[AI] GEMINI_API_KEY not found - text analysis will be disabled`);
    }
  }

  /**
   * Main entry point: Analyze video content using both Gemini and Rekognition
   * Returns AI-predicted category IDs to be merged with user-selected categories
   */
  async analyzeVideo(
    inputPath: string,
    title: string,
    description: string,
    duration: number,
  ): Promise<AiCategoryResult> {
    console.log(`\n[AI] ========== AI CONTENT ANALYSIS ==========`);
    console.log(`[AI] Title: "${title}"`);
    console.log(`[AI] Description: "${description?.substring(0, 100)}..."`);

    const categoryScores: Record<string, number> = {};
    let geminiCategories: string[] = [];
    let rekognitionLabels: string[] = [];

    // Run both analyses in parallel for speed
    const [geminiResult, rekognitionResult] = await Promise.allSettled([
      this.analyzeWithGemini(title, description),
      this.analyzeWithRekognition(inputPath, duration),
    ]);

    // Process Gemini results
    if (geminiResult.status === 'fulfilled' && geminiResult.value.length > 0) {
      geminiCategories = geminiResult.value;
      console.log(`[AI] Gemini predicted: [${geminiCategories.join(', ')}]`);
      for (const cat of geminiCategories) {
        categoryScores[cat] = (categoryScores[cat] || 0) + 0.6; // Gemini weight: 60%
      }
    } else {
      console.warn(`[AI] Gemini analysis failed or returned empty`);
      if (geminiResult.status === 'rejected') {
        console.warn(`[AI] Gemini error: ${geminiResult.reason?.message}`);
      }
    }

    // Process Rekognition results
    if (rekognitionResult.status === 'fulfilled' && rekognitionResult.value.length > 0) {
      const labelResults = rekognitionResult.value;
      rekognitionLabels = labelResults.map(l => l.label);
      console.log(`[AI] Rekognition labels: [${rekognitionLabels.join(', ')}]`);

      for (const { label, confidence } of labelResults) {
        const mappedCategories = REKOGNITION_LABEL_MAP[label] || [];
        for (const cat of mappedCategories) {
          // Rekognition weight: 40%, scaled by confidence (0-100 → 0-0.4)
          categoryScores[cat] = (categoryScores[cat] || 0) + (confidence / 100) * 0.4;
        }
      }
    } else {
      console.warn(`[AI] Rekognition analysis failed or returned empty`);
      if (rekognitionResult.status === 'rejected') {
        console.warn(`[AI] Rekognition error: ${rekognitionResult.reason?.message}`);
      }
    }

    // Convert category names to IDs, filter by minimum confidence threshold
    const MIN_CONFIDENCE = 0.3; // Minimum combined score to suggest a category
    const MAX_AI_CATEGORIES = 3; // Maximum AI suggestions

    const sortedCategories = Object.entries(categoryScores)
      .filter(([_, score]) => score >= MIN_CONFIDENCE)
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_AI_CATEGORIES);

    const categoryIds = sortedCategories
      .map(([name]) => CATEGORIES.find(c => c.name === name)?.id)
      .filter((id): id is number => id !== undefined);

    const confidence: Record<string, number> = {};
    for (const [name, score] of sortedCategories) {
      confidence[name] = Math.round(score * 100) / 100;
    }

    console.log(`[AI] Final scores: ${JSON.stringify(confidence)}`);
    console.log(`[AI] Selected category IDs: [${categoryIds.join(', ')}]`);
    console.log(`[AI] ========== AI ANALYSIS COMPLETE ==========\n`);

    return {
      categoryIds,
      geminiCategories,
      rekognitionLabels,
      confidence,
    };
  }

  // ============================================
  // GEMINI TEXT ANALYSIS
  // ============================================
  // Sends title + description to Gemini Flash model
  // and asks it to classify into our 15 categories
  // ============================================
  private async analyzeWithGemini(title: string, description: string): Promise<string[]> {
    if (!this.geminiApiKey) {
      return [];
    }

    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(this.geminiApiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const categoryNames = CATEGORIES.map(c => c.name).join(', ');

      const prompt = `You are a video content classifier for a short video platform (like TikTok).

Given the following video title and description, classify it into 1-3 of these categories:
[${categoryNames}]

Video title: "${title}"
Video description: "${description || 'No description'}"

IMPORTANT RULES:
- Return ONLY the category names from the list above, separated by commas
- Return 1 to 3 categories maximum
- Do NOT explain, just return the category names
- If unsure, pick the most likely 1-2 categories
- Category names must match EXACTLY from the list

Example response: music, entertainment
Example response: food
Example response: sports, lifestyle`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim().toLowerCase();

      // Parse response - extract valid category names
      const validCategoryNames = CATEGORIES.map(c => c.name);
      const parsed = text
        .split(/[,\n]+/)
        .map(s => s.trim())
        .filter(s => validCategoryNames.includes(s));

      return parsed.slice(0, 3);
    } catch (error) {
      console.error(`[AI] Gemini analysis error:`, error.message);
      return [];
    }
  }

  // ============================================
  // AWS REKOGNITION IMAGE ANALYSIS
  // ============================================
  // Extracts 3 frames from video (25%, 50%, 75% of duration)
  // Sends each to Rekognition DetectLabels API
  // Returns aggregated labels with confidence scores
  // ============================================
  private async analyzeWithRekognition(
    inputPath: string,
    duration: number,
  ): Promise<{ label: string; confidence: number }[]> {
    if (!this.rekognitionClient) {
      return [];
    }

    // Extract 3 frames at 25%, 50%, 75% of video duration
    // Avoids first frame (often black/intro) and last frame (often credits)
    const frameTimes = [
      Math.max(1, Math.floor(duration * 0.25)),
      Math.max(2, Math.floor(duration * 0.50)),
      Math.max(3, Math.floor(duration * 0.75)),
    ];

    const tempDir = path.join(path.dirname(inputPath), `_ai_frames_${Date.now()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      // Extract frames using FFmpeg
      const framePaths: string[] = [];
      for (let i = 0; i < frameTimes.length; i++) {
        const framePath = path.join(tempDir, `frame_${i}.jpg`);
        await this.extractFrame(inputPath, framePath, frameTimes[i]);
        if (fs.existsSync(framePath)) {
          framePaths.push(framePath);
        }
      }

      if (framePaths.length === 0) {
        console.warn(`[AI] No frames extracted for Rekognition`);
        return [];
      }

      console.log(`[AI] Extracted ${framePaths.length} frames for Rekognition`);

      // Send each frame to Rekognition (parallel for speed)
      const labelPromises = framePaths.map(fp => this.detectLabels(fp));
      const results = await Promise.allSettled(labelPromises);

      // Aggregate labels across all frames
      const labelMap = new Map<string, number>();
      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const { label, confidence } of result.value) {
            // Keep highest confidence for each label
            const existing = labelMap.get(label) || 0;
            if (confidence > existing) {
              labelMap.set(label, confidence);
            }
          }
        }
      }

      // Return labels sorted by confidence, only those we have mappings for
      return Array.from(labelMap.entries())
        .filter(([label]) => REKOGNITION_LABEL_MAP[label])
        .map(([label, confidence]) => ({ label, confidence }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 15); // Top 15 relevant labels
    } finally {
      // Cleanup temp frame files
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          console.log(`[AI] Cleaned up temp frame directory`);
        }
      } catch (e) {
        console.warn(`[AI] Failed to cleanup temp frames: ${e.message}`);
      }
    }
  }

  /**
   * Extract a single frame from video at specified time using FFmpeg
   */
  private extractFrame(inputPath: string, outputPath: string, timeSeconds: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const seekTime = this.formatSeekTime(timeSeconds);

      ffmpeg(inputPath)
        .outputOptions([
          '-ss', seekTime,
          '-vframes', '1',
          '-vf', 'scale=640:-1', // Downscale for Rekognition (saves bandwidth)
          '-q:v', '3',
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => {
          console.warn(`[AI] Frame extraction failed at ${seekTime}: ${err.message}`);
          resolve(); // Don't reject - skip this frame
        })
        .run();
    });
  }

  /**
   * Send an image to AWS Rekognition DetectLabels
   */
  private async detectLabels(imagePath: string): Promise<{ label: string; confidence: number }[]> {
    const imageBytes = fs.readFileSync(imagePath);

    const command = new DetectLabelsCommand({
      Image: { Bytes: imageBytes },
      MaxLabels: 20,
      MinConfidence: 60, // Only labels with >60% confidence
    });

    const response = await this.rekognitionClient!.send(command);

    return (response.Labels || [])
      .filter(label => label.Name && label.Confidence)
      .map(label => ({
        label: label.Name!,
        confidence: label.Confidence!,
      }));
  }

  private formatSeekTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  }
}

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface ChunkedUpload {
  uploadId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  uploadedChunks: Set<number>;
  userId: string;
  title: string;
  description?: string;
  createdAt: Date;
  tempDir: string;
}

@Injectable()
export class ChunkedUploadService {
  private uploads: Map<string, ChunkedUpload> = new Map();
  private readonly tempDir: string;
  private readonly cleanupInterval: number = 3600000; // 1 hour

  constructor(private configService: ConfigService) {
    this.tempDir = this.configService.get<string>('CHUNKED_UPLOAD_TEMP_DIR') || './uploads/temp_chunks';
    
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Clean up stale uploads every hour
    setInterval(() => this.cleanupStaleUploads(), this.cleanupInterval);
  }

  initUpload(fileName: string, fileSize: number, totalChunks: number, userId: string, title: string, description?: string): string {
    const uploadId = uuidv4();
    const tempUploadDir = path.join(this.tempDir, uploadId);

    if (!fs.existsSync(tempUploadDir)) {
      fs.mkdirSync(tempUploadDir, { recursive: true });
    }

    this.uploads.set(uploadId, {
      uploadId,
      fileName,
      fileSize,
      totalChunks,
      uploadedChunks: new Set(),
      userId,
      title,
      description,
      createdAt: new Date(),
      tempDir: tempUploadDir,
    });

    console.log(`📦 Chunked upload initialized: ${uploadId}`);
    console.log(`   File: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`   Chunks: ${totalChunks}`);

    return uploadId;
  }

  async uploadChunk(uploadId: string, chunkIndex: number, chunkBuffer: Buffer): Promise<{ uploadedChunks: number; totalChunks: number }> {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new NotFoundException('Upload session not found');
    }

    const chunkPath = path.join(upload.tempDir, `chunk_${chunkIndex}`);
    
    try {
      await fs.promises.writeFile(chunkPath, chunkBuffer);
      upload.uploadedChunks.add(chunkIndex);

      console.log(`✅ Chunk ${chunkIndex}/${upload.totalChunks} uploaded for ${uploadId}`);

      return {
        uploadedChunks: upload.uploadedChunks.size,
        totalChunks: upload.totalChunks,
      };
    } catch (error) {
      console.error(`❌ Failed to save chunk ${chunkIndex}:`, error);
      throw new BadRequestException('Failed to save chunk');
    }
  }

  async completeUpload(uploadId: string): Promise<{ filePath: string; fileName: string; metadata: any }> {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new NotFoundException('Upload session not found');
    }

    // Verify all chunks are uploaded
    if (upload.uploadedChunks.size !== upload.totalChunks) {
      throw new BadRequestException(
        `Missing chunks: ${upload.uploadedChunks.size}/${upload.totalChunks} uploaded`,
      );
    }

    console.log(`🔗 Merging ${upload.totalChunks} chunks for ${uploadId}...`);

    const finalFileName = `${uuidv4()}_${upload.fileName}`;
    const finalPath = path.join('./uploads/raw_videos', finalFileName);

    try {
      // Merge all chunks in order
      const writeStream = fs.createWriteStream(finalPath);

      for (let i = 0; i < upload.totalChunks; i++) {
        const chunkPath = path.join(upload.tempDir, `chunk_${i}`);
        const chunkBuffer = await fs.promises.readFile(chunkPath);
        writeStream.write(chunkBuffer);
      }

      await new Promise((resolve, reject) => {
        writeStream.end((err) => (err ? reject(err) : resolve(null)));
      });

      // Verify final file size
      const stats = fs.statSync(finalPath);
      console.log(`✅ File merged successfully: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      // Clean up temp chunks
      await this.cleanupUpload(uploadId);

      return {
        filePath: `uploads/raw_videos/${finalFileName}`,
        fileName: finalFileName,
        metadata: {
          userId: upload.userId,
          title: upload.title,
          description: upload.description,
        },
      };
    } catch (error) {
      console.error(`❌ Failed to merge chunks:`, error);
      throw new BadRequestException('Failed to merge chunks');
    }
  }

  getUploadStatus(uploadId: string): { uploadedChunks: number; totalChunks: number } {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new NotFoundException('Upload session not found');
    }

    return {
      uploadedChunks: upload.uploadedChunks.size,
      totalChunks: upload.totalChunks,
    };
  }

  private async cleanupUpload(uploadId: string): Promise<void> {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;

    try {
      // Delete temp directory
      if (fs.existsSync(upload.tempDir)) {
        await fs.promises.rm(upload.tempDir, { recursive: true, force: true });
      }

      this.uploads.delete(uploadId);
      console.log(`🗑️ Cleaned up upload session: ${uploadId}`);
    } catch (error) {
      console.error(`⚠️ Failed to cleanup upload ${uploadId}:`, error);
    }
  }

  private cleanupStaleUploads(): void {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [uploadId, upload] of this.uploads.entries()) {
      if (now.getTime() - upload.createdAt.getTime() > maxAge) {
        console.log(`🗑️ Cleaning up stale upload: ${uploadId}`);
        this.cleanupUpload(uploadId);
      }
    }
  }
}

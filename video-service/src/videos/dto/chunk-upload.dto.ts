import { IsNotEmpty, IsString, IsNumber, Min, IsOptional, IsArray, IsBoolean, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';

export class InitChunkedUploadDto {
  @IsNotEmpty()
  @IsString()
  fileName: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => typeof value === 'string' ? parseInt(value) : value)
  fileSize: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => typeof value === 'string' ? parseInt(value) : value)
  totalChunks: number;

  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return value.split(',').map(Number).filter(n => !isNaN(n)); }
    }
    return value;
  })
  categoryIds?: number[];

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? parseFloat(value) : value)
  thumbnailTimestamp?: number;

  @IsOptional()
  @IsString()
  visibility?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value;
  })
  allowComments?: boolean;
}

export class UploadChunkDto {
  @IsNotEmpty()
  @IsString()
  uploadId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => typeof value === 'string' ? parseInt(value) : value)
  chunkIndex: number;
}

export class CompleteChunkedUploadDto {
  @IsNotEmpty()
  @IsString()
  uploadId: string;
}

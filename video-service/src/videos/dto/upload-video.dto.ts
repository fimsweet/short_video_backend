import { IsString, IsOptional, IsNotEmpty, IsArray, IsNumber, IsEnum, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { VideoVisibility } from '../../entities/video.entity';

export class UploadVideoDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  @Transform(({ value }) => {
    // Handle string input (from form-data)
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value.split(',').map(Number).filter(n => !isNaN(n));
      }
    }
    return value;
  })
  categoryIds?: number[];

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? undefined : parsed;
    }
    return value;
  })
  thumbnailTimestamp?: number; // Timestamp in seconds for auto-generated thumbnail frame

  @IsOptional()
  @IsEnum(VideoVisibility)
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (Object.values(VideoVisibility).includes(lower as VideoVisibility)) {
        return lower;
      }
    }
    return value;
  })
  visibility?: VideoVisibility; // public, friends, private

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return value;
  })
  allowComments?: boolean; // default true
}

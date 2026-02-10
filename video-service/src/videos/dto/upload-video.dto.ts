import { IsString, IsOptional, IsNotEmpty, IsArray, IsNumber } from 'class-validator';
import { Transform } from 'class-transformer';

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
}

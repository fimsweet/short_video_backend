import { IsNotEmpty, IsString, IsNumber, Min } from 'class-validator';

export class InitChunkedUploadDto {
  @IsNotEmpty()
  @IsString()
  fileName: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  fileSize: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  totalChunks: number;

  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsString()
  description?: string;
}

export class UploadChunkDto {
  @IsNotEmpty()
  @IsString()
  uploadId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  chunkIndex: number;
}

export class CompleteChunkedUploadDto {
  @IsNotEmpty()
  @IsString()
  uploadId: string;
}

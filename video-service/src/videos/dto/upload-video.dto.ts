import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

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
}

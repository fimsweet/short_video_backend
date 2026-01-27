import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { VideoProcessorService } from './video.processor';
import { Video } from '../entities/video.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    HttpModule,
  ],
  providers: [VideoProcessorService],
})
export class ProcessorModule {}

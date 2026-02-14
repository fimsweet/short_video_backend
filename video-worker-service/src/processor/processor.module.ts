import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { VideoProcessorService } from './video.processor';
import { AiAnalysisService } from '../config/ai-analysis.service';
import { Video } from '../entities/video.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    HttpModule,
  ],
  providers: [VideoProcessorService, AiAnalysisService],
})
export class ProcessorModule {}

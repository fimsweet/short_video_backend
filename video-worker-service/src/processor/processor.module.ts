import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VideoProcessorService } from './video.processor';
import { Video } from '../entities/video.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Video])],
  providers: [VideoProcessorService],
})
export class ProcessorModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { FollowsService } from './follows.service';
import { FollowsController } from './follows.controller';
import { Follow } from '../entities/follow.entity';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Follow]),
    HttpModule,
    ActivityHistoryModule,
  ],
  controllers: [FollowsController],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule { }


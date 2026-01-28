import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityHistory } from '../entities/activity-history.entity';
import { ActivityHistoryService } from './activity-history.service';
import { ActivityHistoryController } from './activity-history.controller';

@Module({
    imports: [TypeOrmModule.forFeature([ActivityHistory])],
    providers: [ActivityHistoryService],
    controllers: [ActivityHistoryController],
    exports: [ActivityHistoryService],
})
export class ActivityHistoryModule { }

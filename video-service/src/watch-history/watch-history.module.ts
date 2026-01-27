import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchHistoryService } from './watch-history.service';
import { WatchHistoryController } from './watch-history.controller';
import { WatchHistory } from '../entities/watch-history.entity';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WatchHistory]),
    forwardRef(() => CategoriesModule),
  ],
  controllers: [WatchHistoryController],
  providers: [WatchHistoryService],
  exports: [WatchHistoryService],
})
export class WatchHistoryModule {}

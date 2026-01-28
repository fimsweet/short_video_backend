import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ActivityHistoryService } from './activity-history.service';
import type { LogActivityDto } from './activity-history.service';

@Controller('activity-history')
export class ActivityHistoryController {
    constructor(private readonly activityHistoryService: ActivityHistoryService) { }

    @Post()
    async logActivity(@Body() dto: LogActivityDto) {
        return this.activityHistoryService.logActivity(dto);
    }

    @Get(':userId')
    async getActivityHistory(
        @Param('userId') userId: string,
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '20',
        @Query('filter') filter?: string,
    ) {
        return this.activityHistoryService.getActivityHistory(
            parseInt(userId),
            parseInt(page),
            parseInt(limit),
            filter,
        );
    }
}

import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
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

    // Delete a single activity
    @Delete(':userId/:activityId')
    async deleteActivity(
        @Param('userId') userId: string,
        @Param('activityId') activityId: string,
    ) {
        return this.activityHistoryService.deleteActivity(
            parseInt(userId),
            parseInt(activityId),
        );
    }

    // Delete all activities for a user
    @Delete(':userId/all')
    async deleteAllActivities(@Param('userId') userId: string) {
        return this.activityHistoryService.deleteAllActivities(parseInt(userId));
    }

    // Delete activities by type
    @Delete(':userId/type/:actionType')
    async deleteActivitiesByType(
        @Param('userId') userId: string,
        @Param('actionType') actionType: string,
    ) {
        return this.activityHistoryService.deleteActivitiesByType(
            parseInt(userId),
            actionType,
        );
    }

    // Delete activities by time range (today, week, month, all) with optional filter
    @Delete(':userId/range/:timeRange')
    async deleteActivitiesByTimeRange(
        @Param('userId') userId: string,
        @Param('timeRange') timeRange: 'today' | 'week' | 'month' | 'all',
        @Query('filter') filter?: string,
    ) {
        return this.activityHistoryService.deleteActivitiesByTimeRange(
            parseInt(userId),
            timeRange,
            filter,
        );
    }

    // Get activity count by time range and filter (for preview before delete)
    @Get(':userId/count/:timeRange')
    async getActivityCount(
        @Param('userId') userId: string,
        @Param('timeRange') timeRange: 'today' | 'week' | 'month' | 'all',
        @Query('filter') filter?: string,
    ) {
        return this.activityHistoryService.getActivityCount(
            parseInt(userId),
            timeRange,
            filter,
        );
    }
}

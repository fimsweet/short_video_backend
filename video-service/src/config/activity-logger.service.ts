import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface LogActivityDto {
    userId: number;
    actionType: string;
    targetId?: string;
    targetType?: string;
    metadata?: Record<string, any>;
}

@Injectable()
export class ActivityLoggerService {
    private readonly userServiceUrl: string;

    constructor(
        private httpService: HttpService,
        private configService: ConfigService,
    ) {
        this.userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
    }

    async logActivity(dto: LogActivityDto): Promise<void> {
        try {
            await firstValueFrom(
                this.httpService.post(`${this.userServiceUrl}/activity-history`, dto)
            );
        } catch (error) {
            console.error('Error logging activity to user-service:', error.message);
        }
    }
}

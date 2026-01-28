import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ActivityLoggerService } from './activity-logger.service';

@Global()
@Module({
    imports: [HttpModule],
    providers: [ActivityLoggerService],
    exports: [ActivityLoggerService],
})
export class ActivityLoggerModule { }

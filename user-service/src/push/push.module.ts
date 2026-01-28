import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushController } from './push.controller';
import { FcmModule } from '../fcm/fcm.module';
import { UserSession } from '../entities/user-session.entity';
import { UserSettings } from '../entities/user-settings.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserSession, UserSettings]),
    FcmModule,
  ],
  controllers: [PushController],
})
export class PushModule {}

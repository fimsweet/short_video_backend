import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from '../entities/user.entity';
import { BlockedUser } from '../entities/blocked-user.entity';
import { UserSettings } from '../entities/user-settings.entity';
import { Follow } from '../entities/follow.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, BlockedUser, UserSettings, Follow])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

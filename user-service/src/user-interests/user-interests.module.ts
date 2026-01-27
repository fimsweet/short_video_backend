import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { UserInterest } from '../entities/user-interest.entity';
import { User } from '../entities/user.entity';
import { UserInterestsService } from './user-interests.service';
import { UserInterestsController } from './user-interests.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserInterest, User]),
    HttpModule,
  ],
  controllers: [UserInterestsController],
  providers: [UserInterestsService],
  exports: [UserInterestsService],
})
export class UserInterestsModule {}

import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Video } from '../entities/video.entity';
import { Like } from '../entities/like.entity';
import { Comment } from '../entities/comment.entity';

export const getDatabaseConfig = (configService: ConfigService): TypeOrmModuleOptions => ({
  type: 'mysql',
  host: configService.get('DB_HOST'),
  port: configService.get('DB_PORT'),
  username: configService.get('DB_USERNAME'),
  password: configService.get('DB_PASSWORD'),
  database: configService.get('DB_DATABASE'),
  entities: [Video, Like, Comment], // Add Like and Comment entities
  synchronize: true, // ⚠️ Set false in production
  logging: true,
});

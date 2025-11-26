import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Video } from '../entities/video.entity';
import { Like } from '../entities/like.entity';
import { Comment } from '../entities/comment.entity';
import { CommentLike } from '../entities/comment-like.entity';
import { Notification } from '../entities/notification.entity';
import { SavedVideo } from '../entities/saved-video.entity';
import { Message } from '../entities/message.entity';
import { Conversation } from '../entities/conversation.entity';

export const getDatabaseConfig = (configService: ConfigService): TypeOrmModuleOptions => ({
  type: 'mysql',
  host: configService.get<string>('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 3306),
  username: configService.get<string>('DB_USERNAME', 'admin'),
  password: configService.get<string>('DB_PASSWORD', 'password'),
  database: configService.get<string>('DB_NAME', 'short_video_db'),
  entities: [Video, Like, Comment, CommentLike, Notification, SavedVideo, Message, Conversation],
  synchronize: true,
  logging: configService.get<string>('NODE_ENV') === 'development',
  autoLoadEntities: true,
});

import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  username: process.env.DB_USERNAME || 'admin',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'short_video_db',
  entities: [User],
  synchronize: true, // Set to true for development only
  logging: process.env.NODE_ENV === 'development',
  autoLoadEntities: true,
  retryAttempts: 3,
  retryDelay: 3000,
};

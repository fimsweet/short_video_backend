import { getDatabaseConfig } from './database.config';
import { ConfigService } from '@nestjs/config';

describe('DatabaseConfig', () => {
  let configService: Partial<ConfigService>;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          DB_HOST: 'localhost',
          DB_PORT: 3306,
          DB_USERNAME: 'root',
          DB_PASSWORD: 'password',
          DB_DATABASE: 'video_db',
        };
        return config[key];
      }),
    };
  });

  it('should return TypeORM config with correct values', () => {
    const config = getDatabaseConfig(configService as ConfigService) as any;
    expect(config.type).toBe('mysql');
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(3306);
    expect(config.username).toBe('root');
    expect(config.password).toBe('password');
    expect(config.database).toBe('video_db');
    expect(config.synchronize).toBe(false);
    expect(config.logging).toBe(true);
  });

  it('should include Video entity', () => {
    const config = getDatabaseConfig(configService as ConfigService) as any;
    expect(config.entities).toBeDefined();
    expect(Array.isArray(config.entities)).toBe(true);
    expect((config.entities as any[]).length).toBe(1);
  });
});

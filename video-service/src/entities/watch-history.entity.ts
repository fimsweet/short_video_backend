import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('watch_history')
@Index(['userId', 'videoId'], { unique: true })
@Index(['userId', 'watchedAt'])
export class WatchHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  userId: string;

  @Column({ type: 'uuid' })
  @Index()
  videoId: string;

  @Column({ type: 'int', default: 0 })
  watchDuration: number; // Watch duration in seconds

  @Column({ type: 'int', default: 0 })
  videoDuration: number; // Total video duration in seconds

  @Column({ type: 'float', default: 0 })
  watchPercentage: number; // Percentage of video watched (0-100)

  @Column({ type: 'int', default: 1 })
  watchCount: number; // Number of times this video was rewatched

  @Column({ type: 'boolean', default: false })
  isCompleted: boolean; // Whether video was fully watched (>90%)

  @CreateDateColumn()
  watchedAt: Date;

  @UpdateDateColumn()
  lastWatchedAt: Date;
}

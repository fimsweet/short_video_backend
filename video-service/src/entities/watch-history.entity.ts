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
  watchDuration: number; // Thời gian xem (giây)

  @Column({ type: 'int', default: 0 })
  videoDuration: number; // Tổng thời lượng video (giây)

  @Column({ type: 'float', default: 0 })
  watchPercentage: number; // % video đã xem (0-100)

  @Column({ type: 'int', default: 1 })
  watchCount: number; // Số lần xem lại video này

  @Column({ type: 'boolean', default: false })
  isCompleted: boolean; // Đã xem hết video chưa (>90%)

  @CreateDateColumn()
  watchedAt: Date;

  @UpdateDateColumn()
  lastWatchedAt: Date;
}

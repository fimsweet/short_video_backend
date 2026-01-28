import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

export type DevicePlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos' | 'linux' | 'unknown';

@Entity('user_sessions')
export class UserSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 500 })
  token: string;

  @Column({ type: 'varchar', length: 50, default: 'unknown' })
  platform: DevicePlatform;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deviceName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deviceModel: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  osVersion: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  appVersion: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  location: string | null;

  // FCM Push Notification Token
  @Column({ type: 'varchar', length: 500, nullable: true })
  fcmToken: string | null;

  // Login alerts preference for this device
  @Column({ type: 'boolean', default: true })
  loginAlertsEnabled: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'boolean', default: false })
  isCurrent: boolean;

  @CreateDateColumn()
  loginAt: Date;

  @Column({ type: 'datetime', nullable: true })
  lastActivityAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  logoutAt: Date | null;
}

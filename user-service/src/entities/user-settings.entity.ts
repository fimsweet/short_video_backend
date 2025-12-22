import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('user_settings')
export class UserSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  userId: number;

  @OneToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  // Theme settings
  @Column({ default: 'dark', length: 50 })
  theme: string; // 'light' or 'dark'

  // Notification settings
  @Column({ default: true })
  notificationsEnabled: boolean;

  @Column({ default: true })
  pushNotifications: boolean;

  @Column({ default: true })
  emailNotifications: boolean;

  // Privacy settings
  @Column({ default: 'public', length: 50 })
  accountPrivacy: string; // 'public', 'private', 'friends'

  @Column({ default: true })
  showOnlineStatus: boolean;

  // Video settings
  @Column({ default: true })
  autoplayVideos: boolean;

  @Column({ default: 'medium', length: 50 })
  videoQuality: string; // 'low', 'medium', 'high', 'auto'

  // Language and region
  @Column({ default: 'vi', length: 10 })
  language: string;

  @Column({ nullable: true, length: 100 })
  timezone: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

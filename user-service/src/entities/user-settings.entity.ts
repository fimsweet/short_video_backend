import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('user_settings')
export class UserSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  userId: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
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

  @Column({ default: true })
  loginAlertsEnabled: boolean; // Push notifications for new login events

  // Push notification preferences (granular)
  @Column({ default: true })
  pushLikes: boolean;

  @Column({ default: true })
  pushComments: boolean;

  @Column({ default: true })
  pushNewFollowers: boolean;

  @Column({ default: true })
  pushMentions: boolean;

  @Column({ default: true })
  pushMessages: boolean;

  @Column({ default: true })
  pushProfileViews: boolean;

  // In-app notification preferences (granular)
  @Column({ default: true })
  inAppLikes: boolean;

  @Column({ default: true })
  inAppComments: boolean;

  @Column({ default: true })
  inAppNewFollowers: boolean;

  @Column({ default: true })
  inAppMentions: boolean;

  @Column({ default: true })
  inAppMessages: boolean;

  @Column({ default: true })
  inAppProfileViews: boolean;

  // Privacy settings
  @Column({ default: 'public', length: 50 })
  accountPrivacy: string; // 'public', 'private', 'friends'

  @Column({ default: false })
  requireFollowApproval: boolean; // When true, follow requests need approval

  @Column({ default: true })
  showOnlineStatus: boolean;

  // Who can view/interact settings (TikTok-style)
  @Column({ default: 'everyone', length: 50 })
  whoCanViewVideos: string; // 'everyone', 'friends', 'onlyMe'

  @Column({ default: 'everyone', length: 50 })
  whoCanSendMessages: string; // 'everyone', 'friends', 'noOne'

  @Column({ default: 'everyone', length: 50 })
  whoCanComment: string; // 'everyone', 'friends', 'noOne'

  @Column({ default: true })
  filterComments: boolean; // Enable comment filtering

  // TikTok-style privacy: who can see your lists
  @Column({ default: 'everyone', length: 50 })
  whoCanViewFollowingList: string; // 'everyone', 'friends', 'onlyMe'

  @Column({ default: 'everyone', length: 50 })
  whoCanViewFollowersList: string; // 'everyone', 'friends', 'onlyMe'

  @Column({ default: 'everyone', length: 50 })
  whoCanViewLikedVideos: string; // 'everyone', 'friends', 'onlyMe'

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

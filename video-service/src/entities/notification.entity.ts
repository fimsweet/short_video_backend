import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum NotificationType {
  FOLLOW = 'follow',
  COMMENT = 'comment',
  LIKE = 'like',
  MENTION = 'mention',
  REPLY = 'reply',
  MESSAGE = 'message',
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  recipientId: string; // User receiving the notification

  @Column()
  senderId: string; // User who triggered the notification

  @Column({
    type: 'enum',
    enum: NotificationType,
  })
  type: NotificationType;

  @Column({ nullable: true })
  videoId: string; // For comment/like notifications

  @Column({ nullable: true })
  commentId: string; // For comment notifications

  @Column({ nullable: true, type: 'text' })
  message: string;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @CreateDateColumn()
  createdAt: Date;
}

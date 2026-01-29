import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  senderId: string;

  @Column()
  @Index()
  recipientId: string;

  @Column('text')
  content: string;

  @Column({ type: 'simple-array', nullable: true })
  imageUrls: string[];

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  // Pinned by user (userId who pinned this message)
  @Column({ nullable: true })
  pinnedBy: string;

  @Column({ nullable: true })
  pinnedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  @Index()
  conversationId: string; // To group messages between two users
}

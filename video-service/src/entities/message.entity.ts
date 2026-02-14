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

  // Reply to another message
  @Column({ nullable: true })
  replyToId: string;

  @Column({ type: 'text', nullable: true })
  replyToContent: string;

  @Column({ nullable: true })
  replyToSenderId: string;

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

  // ========== MESSAGE DELETION ==========
  
  // Message deleted for everyone (unsend)
  @Column({ type: 'boolean', default: false })
  isDeletedForEveryone: boolean;

  // Users who deleted this message for themselves only
  @Column({ type: 'simple-array', nullable: true })
  deletedForUserIds: string[];

  // When the message was deleted for everyone
  @Column({ nullable: true })
  deletedForEveryoneAt: Date;

  // Who deleted the message for everyone
  @Column({ nullable: true })
  deletedForEveryoneBy: string;

  // ========== MESSAGE EDITING ==========
  
  @Column({ type: 'boolean', default: false })
  isEdited: boolean;

  @Column({ nullable: true })
  editedAt: Date;

  @Column({ type: 'text', nullable: true })
  originalContent: string;
}

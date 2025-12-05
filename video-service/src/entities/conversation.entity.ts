import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('conversations')
export class Conversation {
  @PrimaryColumn()
  id: string; // Format: "{minUserId}_{maxUserId}"

  @Column()
  @Index()
  participant1Id: string;

  @Column()
  @Index()
  participant2Id: string;

  @Column({ nullable: true, type: 'text' })
  lastMessage: string;

  @Column({ nullable: true })
  lastMessageSenderId: string;

  // Mute settings for each participant
  @Column({ default: false })
  isMutedBy1: boolean;

  @Column({ default: false })
  isMutedBy2: boolean;

  // Pin settings for each participant
  @Column({ default: false })
  isPinnedBy1: boolean;

  @Column({ default: false })
  isPinnedBy2: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

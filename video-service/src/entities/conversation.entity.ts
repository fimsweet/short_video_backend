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

  // Theme color for each participant (color id like 'pink', 'purple', etc.)
  @Column({ nullable: true })
  themeColorBy1: string;

  @Column({ nullable: true })
  themeColorBy2: string;

  // Nickname for the other participant (set by each user)
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  nicknameBy1: string | null; // nickname for participant2, set by participant1

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  nicknameBy2: string | null; // nickname for participant1, set by participant2

  // Auto-translate settings for each participant
  @Column({ default: false })
  autoTranslateBy1: boolean;

  @Column({ default: false })
  autoTranslateBy2: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

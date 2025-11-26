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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('blocked_users')
@Unique(['blockerId', 'blockedId'])
export class BlockedUser {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  blockerId: number; // User who blocked

  @Column()
  @Index()
  blockedId: number; // User who is blocked

  @CreateDateColumn()
  createdAt: Date;
}

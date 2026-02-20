import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('follows')
@Index(['followerId', 'followingId'], { unique: true })
export class Follow {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  followerId: number; // User who follows

  @Column()
  @Index()
  followingId: number; // User being followed

  @Column({ default: 'accepted' })
  status: string; // 'accepted' or 'pending'

  @CreateDateColumn()
  createdAt: Date;
}

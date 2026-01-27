import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';

@Entity('user_interests')
@Index(['userId', 'categoryId'], { unique: true })
export class UserInterest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column()
  categoryId: number; // References category from video-service

  @Column({ nullable: true })
  categoryName: string; // Cached category name for quick access

  @Column({ type: 'float', default: 1.0 })
  weight: number; // Interest weight (can be adjusted based on user behavior)

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}

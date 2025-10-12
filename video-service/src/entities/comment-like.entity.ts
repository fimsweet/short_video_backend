import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('comment_likes')
@Index(['commentId', 'userId'], { unique: true })
export class CommentLike {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  commentId: string;

  @Column()
  @Index()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;
}

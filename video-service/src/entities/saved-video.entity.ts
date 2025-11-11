import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('saved_videos')
@Index(['userId', 'videoId'], { unique: true })
export class SavedVideo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  userId: string;

  @Column()
  @Index()
  videoId: string;

  @CreateDateColumn()
  createdAt: Date;
}

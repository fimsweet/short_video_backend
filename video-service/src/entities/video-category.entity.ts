import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Video } from './video.entity';
import { Category } from './category.entity';

@Entity('video_categories')
@Index(['videoId', 'categoryId'], { unique: true })
export class VideoCategory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  videoId: string;

  @Column()
  categoryId: number;

  @Column({ type: 'boolean', default: false })
  isAiSuggested: boolean; // true = AI auto-categorized, false = user-selected

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Video, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'videoId' })
  video: Video;

  @ManyToOne(() => Category, category => category.videoCategories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'categoryId' })
  category: Category;
}

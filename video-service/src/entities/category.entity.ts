import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { VideoCategory } from './video-category.entity';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string; // e.g., 'entertainment', 'music', 'dance'

  @Column()
  displayName: string; // e.g., 'Entertainment', 'Music', 'Dance'

  @Column({ nullable: true })
  displayNameVi: string; // Vietnamese: 'Giải trí', 'Âm nhạc', 'Nhảy'

  @Column({ nullable: true })
  icon: string; // Icon name or emoji

  @Column({ type: 'int', default: 0 })
  sortOrder: number; // For display ordering

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => VideoCategory, videoCategory => videoCategory.category)
  videoCategories: VideoCategory[];
}

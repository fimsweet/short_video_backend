import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Video } from './video.entity';

@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  videoId: string;

  @Column()
  @Index()
  userId: string;

  @Column('text')
  content: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  imageUrl: string | null; // Image attached to comment

  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  parentId: string | null; // For replies

  @Column({ type: 'boolean', default: false })
  isPinned: boolean; // For pinned/highlighted comments

  @Column({ type: 'boolean', default: false })
  isToxic: boolean; // Flagged by AI as toxic/profane content

  @Column({ type: 'text', nullable: true })
  censoredContent: string | null; // Content with bad words replaced by ***

  @Column({ type: 'boolean', default: false })
  isEdited: boolean; // Whether user has edited this comment

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Video, video => video.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'videoId' })
  video: Video;
}

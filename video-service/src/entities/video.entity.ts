import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { Like } from './like.entity';
import { Comment } from './comment.entity';

export enum VideoStatus {
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export enum VideoVisibility {
  PUBLIC = 'public',
  FRIENDS = 'friends',
  PRIVATE = 'private',
}

// ============================================
// DATABASE INDEXES FOR PERFORMANCE
// ============================================
// These indexes optimize common queries:
// - Feed: Get READY videos sorted by createdAt
// - Profile: Get videos by userId
// - Trending: Get videos by viewCount
// ============================================
@Entity('videos')
@Index(['userId']) // Query videos by user (profile page)
@Index(['status']) // Filter by processing status
@Index(['status', 'createdAt']) // Feed query: READY videos sorted by date
@Index(['status', 'visibility']) // Public feed: READY + PUBLIC videos
@Index(['status', 'viewCount']) // Trending: READY videos sorted by views
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string; // User ID who uploaded the video

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  originalFileName: string;

  @Column()
  rawVideoPath: string; // Path to the original uploaded file

  @Column({ nullable: true })
  hlsUrl: string; // URL to HLS playlist.m3u8

  @Column({ nullable: true })
  thumbnailUrl: string;

  @Column({ type: 'int', nullable: true })
  duration: number; // Video duration in seconds

  @Column({ type: 'bigint', nullable: true })
  fileSize: number; // File size in bytes

  @Column({ nullable: true })
  aspectRatio: string; // e.g., "9:16" for TikTok-style videos

  @Column({ type: 'int', default: 0 })
  viewCount: number; // Total view count

  @Column({ type: 'boolean', default: false })
  isHidden: boolean; // Hidden from public feed

  // Privacy settings for individual video
  @Column({
    type: 'enum',
    enum: VideoVisibility,
    default: VideoVisibility.PUBLIC,
  })
  visibility: VideoVisibility; // Who can view this video

  @Column({ type: 'boolean', default: true })
  allowComments: boolean; // Allow comments on this video

  @Column({ type: 'boolean', default: true })
  allowDuet: boolean; // Allow content reuse (Duet, Stitch...)

  @Column({
    type: 'enum',
    enum: VideoStatus,
    default: VideoStatus.UPLOADING,
  })
  status: VideoStatus;

  @Column({ nullable: true })
  errorMessage: string; // Stores error message if processing fails

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Like, like => like.video)
  likes: Like[];

  @OneToMany(() => Comment, comment => comment.video)
  comments: Comment[];
}

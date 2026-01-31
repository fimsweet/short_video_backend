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
// 📊 DATABASE INDEXES FOR PERFORMANCE
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
  userId: string; // ID của user upload video

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  originalFileName: string;

  @Column()
  rawVideoPath: string; // Đường dẫn file gốc

  @Column({ nullable: true })
  hlsUrl: string; // URL đến playlist.m3u8

  @Column({ nullable: true })
  thumbnailUrl: string;

  @Column({ type: 'int', nullable: true })
  duration: number; // Thời lượng video (giây)

  @Column({ type: 'bigint', nullable: true })
  fileSize: number; // Kích thước file (bytes)

  @Column({ nullable: true })
  aspectRatio: string; // e.g., "9:16" for TikTok-style videos

  @Column({ type: 'int', default: 0 })
  viewCount: number; // Số lượt xem video

  @Column({ type: 'boolean', default: false })
  isHidden: boolean; // Ẩn video khỏi feed công khai

  // Privacy settings for individual video
  @Column({
    type: 'enum',
    enum: VideoVisibility,
    default: VideoVisibility.PUBLIC,
  })
  visibility: VideoVisibility; // Ai có thể xem video này

  @Column({ type: 'boolean', default: true })
  allowComments: boolean; // Cho phép bình luận

  @Column({ type: 'boolean', default: true })
  allowDuet: boolean; // Cho phép sử dụng lại nội dung (Duet, Ghép nối...)

  @Column({
    type: 'enum',
    enum: VideoStatus,
    default: VideoStatus.UPLOADING,
  })
  status: VideoStatus;

  @Column({ nullable: true })
  errorMessage: string; // Lưu lỗi nếu processing fail

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Like, like => like.video)
  likes: Like[];

  @OneToMany(() => Comment, comment => comment.video)
  comments: Comment[];
}

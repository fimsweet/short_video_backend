import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Like } from './like.entity';
import { Comment } from './comment.entity';

export enum VideoStatus {
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

@Entity('videos')
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

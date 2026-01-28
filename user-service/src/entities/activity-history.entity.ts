import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('activity_history')
export class ActivityHistory {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column()
    userId: number;

    @Column()
    actionType: string; // 'video_posted', 'video_deleted', 'video_hidden', 'like', 'unlike', 'comment', 'comment_deleted', 'follow', 'unfollow'

    @Column({ nullable: true })
    targetId: string; // videoId, userId, commentId depending on action

    @Column({ nullable: true })
    targetType: string; // 'video', 'user', 'comment'

    @Column({ type: 'json', nullable: true })
    metadata: Record<string, any>; // Additional context (title, username, thumbnail, etc.)

    @CreateDateColumn()
    createdAt: Date;
}

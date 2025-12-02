import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('shares')
export class Share {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  videoId: string;

  @Column()
  sharerId: string;

  @Column()
  recipientId: string;

  @CreateDateColumn()
  createdAt: Date;
}

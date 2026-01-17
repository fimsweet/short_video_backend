import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true, type: 'varchar', length: 100 })
  fullName: string | null;

  @Column({ nullable: true, type: 'varchar', length: 20 })
  phoneNumber: string | null;

  @Column({ nullable: true, type: 'date' })
  dateOfBirth: Date | null;

  @Column({ nullable: true, type: 'varchar', length: 255 })
  avatar: string | null;

  @Column({ nullable: true, type: 'text' })
  bio: string | null;

  @Column({ nullable: true, type: 'varchar', length: 255 })
  website: string | null;

  @Column({ nullable: true, type: 'varchar', length: 255 })
  location: string | null;

  @Column({ nullable: true, type: 'varchar', length: 50 })
  gender: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

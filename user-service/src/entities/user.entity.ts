import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type AuthProvider = 'email' | 'phone' | 'google' | 'facebook' | 'apple';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true, type: 'varchar', length: 255 })
  password: string | null;

  @Column({ type: 'varchar', length: 20, default: 'email' })
  authProvider: AuthProvider;

  @Column({ nullable: true, type: 'varchar', length: 255 })
  providerId: string | null;

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

  @Column({ nullable: true, type: 'varchar', length: 50 })
  gender: string | null;

  @Column({ default: false })
  isVerified: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

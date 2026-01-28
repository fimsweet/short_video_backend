import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type AuthProvider = 'email' | 'phone' | 'google' | 'facebook' | 'apple';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column({ unique: true, nullable: true, type: 'varchar', length: 255 })
  email: string | null;

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

  // Two-Factor Authentication
  @Column({ default: false })
  twoFactorEnabled: boolean;

  @Column({ type: 'simple-array', nullable: true })
  twoFactorMethods: string[] | null; // ['email', 'sms', 'app']

  // Online Status
  @Column({ type: 'datetime', nullable: true })
  lastSeen: Date | null;

  // Account Deactivation
  @Column({ default: false })
  isDeactivated: boolean;

  @Column({ type: 'datetime', nullable: true })
  deactivatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

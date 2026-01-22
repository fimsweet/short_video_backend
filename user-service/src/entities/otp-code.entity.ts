import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type OtpPurpose = 'registration' | '2fa' | '2fa_settings' | 'password_reset' | 'phone_verification' | 'link_email' | 'link_phone' | 'phone_password_reset';

@Entity('otp_codes')
export class OtpCode {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 100 })
    phone: string;  // Can be phone or email depending on purpose

    @Column({ type: 'varchar', length: 6 })
    code: string;

    @Column({ type: 'varchar', length: 50 })
    purpose: OtpPurpose;

    @Column({ type: 'datetime' })
    expiresAt: Date;

    @Column({ default: false })
    isUsed: boolean;

    @Column({ default: 0 })
    attempts: number;

    @CreateDateColumn()
    createdAt: Date;
}

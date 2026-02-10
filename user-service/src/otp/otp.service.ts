import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { OtpCode, OtpPurpose } from '../entities/otp-code.entity';

@Injectable()
export class OtpService {
    constructor(
        @InjectRepository(OtpCode)
        private otpRepository: Repository<OtpCode>,
    ) { }

    // Generate a 6-digit OTP
    private generateOtp(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    // Create and save a new OTP (for phone or email)
    async createOtp(identifier: string, purpose: OtpPurpose): Promise<string> {
        // Rate limiting: max 5 OTPs per identifier per hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentOtps = await this.otpRepository.count({
            where: {
                phone: identifier,
                createdAt: MoreThan(oneHourAgo),
            },
        });

        if (recentOtps >= 5) {
            throw new BadRequestException('Too many OTP requests. Please try again later.');
        }

        // Invalidate any existing unused OTPs for this identifier and purpose
        await this.otpRepository.update(
            { phone: identifier, purpose, isUsed: false },
            { isUsed: true },
        );

        // Generate new OTP
        const code = this.generateOtp();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

        const otp = this.otpRepository.create({
            phone: identifier, // Can be phone or email
            code,
            purpose,
            expiresAt,
        });

        await this.otpRepository.save(otp);
        console.log(`OTP generated for ${identifier}: ${code} (expires at ${expiresAt})`);

        return code;
    }

    // Verify an OTP
    async verifyOtp(identifier: string, code: string, purpose: OtpPurpose): Promise<boolean> {
        const otp = await this.otpRepository.findOne({
            where: {
                phone: identifier,
                code,
                purpose,
                isUsed: false,
                expiresAt: MoreThan(new Date()),
            },
        });

        if (!otp) {
            // Check if OTP exists but expired
            const expiredOtp = await this.otpRepository.findOne({
                where: { phone: identifier, code, purpose },
            });

            if (expiredOtp) {
                if (expiredOtp.isUsed) {
                    throw new BadRequestException('Mã xác thực đã được sử dụng');
                }
                if (expiredOtp.expiresAt < new Date()) {
                    throw new BadRequestException('Mã xác thực đã hết hạn');
                }
            }

            // Increment attempt counter for rate limiting
            await this.incrementAttempts(identifier, purpose);
            throw new BadRequestException('Mã xác thực không đúng');
        }

        // Mark OTP as used
        otp.isUsed = true;
        await this.otpRepository.save(otp);

        console.log(`OTP verified for ${identifier}`);
        return true;
    }

    // Increment failed attempts
    private async incrementAttempts(identifier: string, purpose: OtpPurpose): Promise<void> {
        const otp = await this.otpRepository.findOne({
            where: { phone: identifier, purpose, isUsed: false },
            order: { createdAt: 'DESC' },
        });

        if (otp) {
            otp.attempts += 1;
            if (otp.attempts >= 5) {
                otp.isUsed = true; // Invalidate after 5 failed attempts
                console.log(`OTP invalidated for ${identifier} after 5 failed attempts`);
            }
            await this.otpRepository.save(otp);
        }
    }

    // Clean up expired OTPs (can be called by a cron job)
    async cleanupExpiredOtps(): Promise<void> {
        const result = await this.otpRepository.delete({
            expiresAt: LessThan(new Date()),
        });
        console.log(`Cleaned up ${result.affected} expired OTPs`);
    }
}

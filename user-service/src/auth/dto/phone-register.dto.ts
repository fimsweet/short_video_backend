import { IsString, IsNotEmpty, Matches, IsOptional, IsDateString } from 'class-validator';

// DTO for phone registration with Firebase token
export class PhoneRegisterDto {
    @IsString()
    @IsNotEmpty()
    firebaseIdToken: string; // Firebase ID token after phone verification

    @IsString()
    @IsNotEmpty()
    @Matches(/^[a-zA-Z0-9_]{3,30}$/, {
        message: 'Username must be 3-30 characters, alphanumeric and underscore only',
    })
    username: string;

    @IsOptional()
    @IsString()
    fullName?: string;

    @IsOptional()
    @IsDateString()
    dateOfBirth?: string;
}

// DTO for phone login with Firebase token
export class PhoneLoginDto {
    @IsString()
    @IsNotEmpty()
    firebaseIdToken: string;
}

// DTO for checking phone availability
export class CheckPhoneDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^\+84[0-9]{9,10}$/, {
        message: 'Phone must be Vietnam format: +84xxxxxxxxx',
    })
    phone: string;
}

// DTO for sending OTP (for 2FA, password reset - backend generated)
export class SendOtpDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^\+84[0-9]{9,10}$/, {
        message: 'Phone must be Vietnam format: +84xxxxxxxxx',
    })
    phone: string;

    @IsString()
    @IsNotEmpty()
    purpose: 'registration' | '2fa' | 'password_reset' | 'phone_verification';
}

// DTO for verifying OTP (for 2FA, password reset)
export class VerifyOtpDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^\+84[0-9]{9,10}$/, {
        message: 'Phone must be Vietnam format: +84xxxxxxxxx',
    })
    phone: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^[0-9]{6}$/, {
        message: 'OTP must be 6 digits',
    })
    otp: string;

    @IsString()
    @IsNotEmpty()
    purpose: 'registration' | '2fa' | 'password_reset' | 'phone_verification';
}

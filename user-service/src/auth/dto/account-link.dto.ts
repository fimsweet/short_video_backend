import { IsEmail, IsString, IsNotEmpty, Matches, IsOptional, MinLength } from 'class-validator';

// DTO để gửi OTP link email vào tài khoản
export class SendLinkEmailOtpDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

// DTO để verify và link email vào tài khoản
export class VerifyLinkEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
  otp: string;

  @IsString()
  @IsOptional()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password?: string;
}

// DTO để link SĐT vào tài khoản (dùng Firebase token)
export class LinkPhoneDto {
  @IsString()
  @IsNotEmpty()
  firebaseIdToken: string;
}

// DTO để gửi OTP reset password qua phone
export class SendPhoneResetPasswordOtpDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{9,14}$/, { message: 'Phone must be in E.164 format (e.g., +84814483537)' })
  phone: string;
}

// DTO để verify OTP reset password qua phone
export class VerifyPhoneResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{9,14}$/, { message: 'Phone must be in E.164 format' })
  phone: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
  otp: string;
}

// DTO để đổi password sau khi verify OTP
export class ResetPasswordWithPhoneDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{9,14}$/, { message: 'Phone must be in E.164 format' })
  phone: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
  otp: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  newPassword: string;
}

// DTO để lấy thông tin account liên kết
export class AccountInfoDto {
  id: number;
  username: string;
  email: string | null;
  phoneNumber: string | null;
  authProvider: string;
  hasPassword: boolean;
  isVerified: boolean;
  avatar: string | null;
  fullName: string | null;
}

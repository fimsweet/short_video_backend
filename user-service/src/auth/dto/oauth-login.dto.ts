import { IsEmail, IsNotEmpty, IsString, IsOptional, IsIn, IsDateString, Matches, MaxLength, MinLength } from 'class-validator';

export class OAuthLoginDto {
  @IsNotEmpty({ message: 'Provider is required' })
  @IsString()
  @IsIn(['google', 'facebook', 'apple'], { message: 'Invalid auth provider' })
  provider: 'google' | 'facebook' | 'apple';

  @IsNotEmpty({ message: 'ID Token is required' })
  @IsString()
  idToken: string;
}

export class OAuthRegisterDto {
  @IsNotEmpty({ message: 'Provider is required' })
  @IsString()
  @IsIn(['google', 'facebook', 'apple'], { message: 'Invalid auth provider' })
  provider: 'google' | 'facebook' | 'apple';

  @IsNotEmpty({ message: 'Provider ID is required' })
  @IsString()
  providerId: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsNotEmpty({ message: 'Username is required' })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters' })
  @MaxLength(30, { message: 'Username must not exceed 30 characters' })
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Username can only contain letters, numbers and underscores' })
  username: string;

  @IsNotEmpty({ message: 'Date of birth is required' })
  @IsDateString({}, { message: 'Please provide a valid date of birth' })
  dateOfBirth: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  fullName?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

export class PhoneRegisterDto {
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Please provide a valid phone number' })
  phoneNumber: string;

  @IsNotEmpty({ message: 'Verification code is required' })
  @IsString()
  verificationCode: string;

  @IsNotEmpty({ message: 'Username is required' })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters' })
  @MaxLength(30, { message: 'Username must not exceed 30 characters' })
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Username can only contain letters, numbers and underscores' })
  username: string;

  @IsNotEmpty({ message: 'Date of birth is required' })
  @IsDateString({}, { message: 'Please provide a valid date of birth' })
  dateOfBirth: string;

  @IsOptional()
  @IsString()
  password?: string;
}

export class EmailRegisterDto {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(50, { message: 'Password must not exceed 50 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/, { 
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number' 
  })
  password: string;

  @IsNotEmpty({ message: 'Username is required' })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters' })
  @MaxLength(30, { message: 'Username must not exceed 30 characters' })
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Username can only contain letters, numbers and underscores' })
  username: string;

  @IsNotEmpty({ message: 'Date of birth is required' })
  @IsDateString({}, { message: 'Please provide a valid date of birth' })
  dateOfBirth: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  fullName?: string;
}

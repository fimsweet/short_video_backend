import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OtpModule } from '../otp/otp.module';
import { FirebaseAdminService } from './firebase-admin.service';
import { EmailService } from '../config/email.service';
import { SessionsModule } from '../sessions/sessions.module';
import { TotpService } from './totp.service';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    OtpModule,
    forwardRef(() => SessionsModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key-fallback',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, FirebaseAdminService, EmailService, TotpService],
  exports: [FirebaseAdminService, TotpService],
})
export class AuthModule { }
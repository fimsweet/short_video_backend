import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { OAuthRegisterDto, EmailRegisterDto } from './dto/oauth-login.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '../entities/user.entity';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    // Initialize Google OAuth client
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  private async _generateToken(user: { id: number; username: string }) {
    const payload = { username: user.username, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  // Verify Google ID Token
  async verifyGoogleToken(idToken: string) {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });
      const payload = ticket.getPayload();
      
      if (!payload) {
        throw new BadRequestException('Invalid Google token');
      }

      return {
        providerId: payload.sub,
        email: payload.email,
        fullName: payload.name,
        avatar: payload.picture,
        emailVerified: payload.email_verified,
      };
    } catch (error) {
      throw new BadRequestException('Failed to verify Google token');
    }
  }

  // Google OAuth Login/Register
  async googleAuth(idToken: string) {
    const googleUser = await this.verifyGoogleToken(idToken);
    
    // Check if user exists with this Google ID
    let user = await this.usersService.findByProviderId('google', googleUser.providerId);
    
    if (user) {
      // User exists, login
      const { password: _, ...userResult } = user;
      const token = await this._generateToken(user);
      return {
        message: 'Login successful',
        user: userResult,
        isNewUser: false,
        ...token,
      };
    }

    // Check if email already exists with different auth method
    if (googleUser.email) {
      const existingUser = await this.usersService.findByEmail(googleUser.email);
      if (existingUser) {
        throw new ConflictException('Email already registered with different method');
      }
    }

    // Return Google user info for registration flow
    return {
      message: 'New user - complete registration',
      isNewUser: true,
      googleUser: {
        providerId: googleUser.providerId,
        email: googleUser.email,
        fullName: googleUser.fullName,
        avatar: googleUser.avatar,
      },
    };
  }

  // Complete OAuth Registration (Google/Facebook/Apple)
  async completeOAuthRegister(dto: OAuthRegisterDto) {
    // Check username availability
    const existingUsername = await this.usersService.findOne(dto.username);
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    // Check email availability
    const existingEmail = await this.usersService.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    // Create user with OAuth provider
    const user = await this.usersService.createOAuthUser({
      username: dto.username,
      email: dto.email,
      authProvider: dto.provider as AuthProvider,
      providerId: dto.providerId,
      fullName: dto.fullName,
      avatar: dto.avatar,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
    });

    const token = await this._generateToken(user);
    return {
      message: 'User registered successfully',
      user,
      ...token,
    };
  }

  // Email Registration (TikTok style - multi step)
  async emailRegister(dto: EmailRegisterDto) {
    // Check username availability
    const existingUsername = await this.usersService.findOne(dto.username);
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    // Check email availability
    const existingEmail = await this.usersService.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Create user
    const user = await this.usersService.createEmailUser({
      username: dto.username,
      email: dto.email,
      password: hashedPassword,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      fullName: dto.fullName,
    });

    const token = await this._generateToken(user);
    return {
      message: 'User registered successfully',
      user,
      ...token,
    };
  }

  // Check username availability
  async checkUsername(username: string) {
    const user = await this.usersService.findOne(username);
    return {
      available: !user,
      username,
    };
  }

  // Check email availability
  async checkEmail(email: string) {
    const user = await this.usersService.findByEmail(email);
    return {
      available: !user,
      email,
    };
  }

  async register(createUserDto: CreateUserDto) {
    try {
      const user = await this.usersService.create(createUserDto);
      const token = await this._generateToken(user);
      return {
        message: 'User registered successfully',
        user,
        ...token,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new ConflictException('Registration failed');
    }
  }

  async login(usernameOrEmail: string, password: string) {
    // Tìm user bằng username hoặc email
    let user = await this.usersService.findOne(usernameOrEmail);

    // Nếu không tìm thấy bằng username, thử tìm bằng email
    if (!user) {
      user = await this.usersService.findByEmail(usernameOrEmail);
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user registered with OAuth (no password)
    if (!user.password) {
      throw new UnauthorizedException(`This account uses ${user.authProvider} login`);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userResult } = user;
    const token = await this._generateToken(user);

    return {
      message: 'Login successful',
      user: userResult,
      ...token,
    };
  }
}
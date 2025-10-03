import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  private async _generateToken(user: { id: number; username: string }) {
    const payload = { username: user.username, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
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
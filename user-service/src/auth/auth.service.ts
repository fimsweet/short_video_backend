import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(private usersService: UsersService) {}

  async register(createUserDto: CreateUserDto) {
    try {
      // Create new user (UsersService will handle duplicate check)
      const user = await this.usersService.create(createUserDto);
      return {
        message: 'User registered successfully',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
        },
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new ConflictException('Registration failed');
    }
  }

  async login(username: string, password: string) {
    const user = await this.usersService.findOne(username);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    };
  }
}
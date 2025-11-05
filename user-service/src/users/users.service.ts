import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from '../auth/dto/create-user.dto';
import { User } from '../entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto) {
    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: [
        { username: createUserDto.username },
        { email: createUserDto.email }
      ]
    });

    if (existingUser) {
      throw new ConflictException('Username or email already exists');
    }

    // Hash password
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(createUserDto.password, salt);

    // Create new user
    const user = this.userRepository.create({
      username: createUserDto.username,
      email: createUserDto.email,
      password: hashedPassword,
    });

    const savedUser = await this.userRepository.save(user);
    console.log('Created user:', savedUser);

    // Return user without password
    const { password, ...result } = savedUser;
    return result;
  }

  async findOne(username: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { username }
    });
  }

  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id }
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email }
    });
  }

  async updateAvatar(userId: number, avatarPath: string): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.avatar = avatarPath;
    return await this.userRepository.save(user);
  }

  async removeAvatar(userId: number): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.avatar = null;
    return await this.userRepository.save(user);
  }

  async updateProfile(userId: number, updateData: { bio?: string; avatar?: string }) {
    try {
      console.log(`📝 Updating profile for user ${userId}`, updateData);

      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new Error('User not found');
      }

      if (updateData.bio !== undefined) {
        user.bio = updateData.bio;
      }

      if (updateData.avatar !== undefined) {
        user.avatar = updateData.avatar;
      }

      const updatedUser = await this.userRepository.save(user);
      console.log(`✅ Profile updated for user ${userId}`);

      return {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        avatar: updatedUser.avatar,
        bio: updatedUser.bio,
      };
    } catch (error) {
      console.error('❌ Error updating profile:', error);
      throw error;
    }
  }
}

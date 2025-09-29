import { Injectable, ConflictException } from '@nestjs/common';
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
}

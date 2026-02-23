jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
}));
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
  getRepositoryToken: (entity: any) => `${entity?.name || entity}Repository`,
}));
jest.mock('typeorm', () => ({
  Repository: class {},
  Entity: () => () => {},
  Column: () => () => {},
  PrimaryColumn: () => () => {},
  PrimaryGeneratedColumn: () => () => {},
  CreateDateColumn: () => () => {},
  UpdateDateColumn: () => () => {},
  ManyToOne: () => () => {},
  OneToMany: () => () => {},
  JoinColumn: () => () => {},
  Index: () => () => {},
  In: jest.fn(),
  Not: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

describe('CommentsController', () => {
  let controller: CommentsController;
  let service: any;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    service = {
      createComment: jest.fn().mockResolvedValue({ id: 'c1' }),
      getCommentsByVideo: jest.fn().mockResolvedValue([]),
      getReplies: jest.fn().mockResolvedValue([]),
      getCommentCount: jest.fn().mockResolvedValue(10),
      deleteComment: jest.fn().mockResolvedValue(true),
      editComment: jest.fn().mockResolvedValue({ id: 'c1', content: 'edited' }),
      toggleCommentLike: jest.fn().mockResolvedValue({ liked: true }),
      isCommentLikedByUser: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentsController],
      providers: [{ provide: CommentsService, useValue: service }],
    }).compile();

    controller = module.get<CommentsController>(CommentsController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should be defined', () => { expect(controller).toBeDefined(); });

  it('should create comment', async () => {
    const result = await controller.createComment({ videoId: 'v1', userId: 'u1', content: 'nice' });
    expect(result).toEqual({ id: 'c1' });
  });

  it('should create comment with image', async () => {
    await controller.createComment({ videoId: 'v1', userId: 'u1', content: 'nice' }, { filename: 'img.jpg' } as any);
    expect(service.createComment).toHaveBeenCalledWith('v1', 'u1', 'nice', undefined, '/uploads/comment_images/img.jpg');
  });

  it('should get comments by video', async () => {
    await controller.getCommentsByVideo('v1');
    expect(service.getCommentsByVideo).toHaveBeenCalled();
  });

  it('should get replies', async () => {
    await controller.getReplies('c1');
    expect(service.getReplies).toHaveBeenCalledWith('c1');
  });

  it('should get count', async () => {
    const result = await controller.getCommentCount('v1');
    expect(result.count).toBe(10);
  });

  it('should delete comment', async () => {
    const result = await controller.deleteComment('c1', 'u1');
    expect(result.success).toBe(true);
  });

  it('should edit comment', async () => {
    const result = await controller.editComment('c1', { userId: 'u1', content: 'edited' });
    expect(result.content).toBe('edited');
  });

  it('should toggle comment like', async () => {
    const result = await controller.toggleCommentLike({ commentId: 'c1', userId: 'u1' });
    expect(result.liked).toBe(true);
  });

  it('should check comment like', async () => {
    const result = await controller.checkCommentLike('c1', 'u1');
    expect(result.liked).toBe(true);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';

describe('SharesController', () => {
  let controller: SharesController;
  let service: any;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    service = {
      createShare: jest.fn().mockResolvedValue({ id: 's1' }),
      getShareCount: jest.fn().mockResolvedValue(5),
      getSharesByVideo: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SharesController],
      providers: [{ provide: SharesService, useValue: service }],
    }).compile();

    controller = module.get<SharesController>(SharesController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should create share', async () => {
    const result = await controller.createShare({ videoId: 'v1', sharerId: 'u1', recipientId: 'u2' });
    expect(result.id).toBe('s1');
  });

  it('should get share count', async () => {
    const result = await controller.getShareCount('v1');
    expect(result.count).toBe(5);
  });

  it('should get shares by video', async () => {
    await controller.getSharesByVideo('v1');
    expect(service.getSharesByVideo).toHaveBeenCalledWith('v1');
  });
});

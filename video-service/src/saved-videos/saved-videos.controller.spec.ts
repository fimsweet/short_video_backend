import { Test, TestingModule } from '@nestjs/testing';
import { SavedVideosController } from './saved-videos.controller';
import { SavedVideosService } from './saved-videos.service';

describe('SavedVideosController', () => {
  let controller: SavedVideosController;
  let service: any;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    service = {
      toggleSave: jest.fn().mockResolvedValue({ saved: true }),
      isSavedByUser: jest.fn().mockResolvedValue(true),
      getSavedVideos: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SavedVideosController],
      providers: [{ provide: SavedVideosService, useValue: service }],
    }).compile();

    controller = module.get<SavedVideosController>(SavedVideosController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should toggle save', async () => {
    const result = await controller.toggleSave({ videoId: 'v1', userId: 'u1' });
    expect(result.saved).toBe(true);
  });

  it('should check saved', async () => {
    const result = await controller.checkSaved('v1', 'u1');
    expect(result.saved).toBe(true);
  });

  it('should get saved videos', async () => {
    await controller.getSavedVideos('u1');
    expect(service.getSavedVideos).toHaveBeenCalledWith('u1');
  });
});

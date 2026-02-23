import { ActivityLoggerService } from './activity-logger.service';
import { of, throwError } from 'rxjs';

describe('ActivityLoggerService', () => {
  let service: ActivityLoggerService;
  let mockHttp: { post: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation();
    mockHttp = { post: jest.fn().mockReturnValue(of({ data: {} })) };
    const config = { get: jest.fn().mockReturnValue('http://localhost:3000') };
    service = new ActivityLoggerService(mockHttp as any, config as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should log activity successfully', async () => {
    await service.logActivity({
      userId: 1,
      actionType: 'upload_video',
      targetId: 'v1',
      targetType: 'video',
    });
    expect(mockHttp.post).toHaveBeenCalledWith(
      'http://localhost:3000/activity-history',
      expect.objectContaining({ userId: 1, actionType: 'upload_video' }),
    );
  });

  it('should handle error gracefully', async () => {
    mockHttp.post.mockReturnValue(throwError(() => new Error('network failure')));
    await service.logActivity({ userId: 1, actionType: 'delete_video' });
    expect(console.error).toHaveBeenCalled();
  });

  it('should include optional metadata', async () => {
    await service.logActivity({
      userId: 1,
      actionType: 'like',
      metadata: { videoId: 'v1' },
    });
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ metadata: { videoId: 'v1' } }),
    );
  });
});

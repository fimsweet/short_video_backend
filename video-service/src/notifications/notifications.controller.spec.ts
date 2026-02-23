import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: any;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    service = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
      getNotifications: jest.fn().mockResolvedValue([]),
      getUnreadCount: jest.fn().mockResolvedValue(3),
      markAsRead: jest.fn().mockResolvedValue(true),
      markAllAsRead: jest.fn().mockResolvedValue(undefined),
      deleteNotification: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should create notification', async () => {
    const result = await controller.createNotification({ recipientId: 'u1', senderId: 'u2', type: 'like' as any });
    expect(result.success).toBe(true);
  });

  it('should get notifications', async () => {
    const result = await controller.getNotifications('u1');
    expect(result.success).toBe(true);
  });

  it('should get unread count', async () => {
    const result = await controller.getUnreadCount('u1');
    expect(result.count).toBe(3);
  });

  it('should mark as read', async () => {
    const result = await controller.markAsRead('n1', 'u1');
    expect(result.success).toBe(true);
  });

  it('should mark all as read', async () => {
    const result = await controller.markAllAsRead('u1');
    expect(result.success).toBe(true);
  });

  it('should delete notification', async () => {
    const result = await controller.deleteNotification('n1', 'u1');
    expect(result.success).toBe(true);
  });
});

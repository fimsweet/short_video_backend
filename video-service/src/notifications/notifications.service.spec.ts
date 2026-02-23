import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationType } from '../entities/notification.entity';
import { PushNotificationService } from './push-notification.service';
import { MessagesGateway } from '../messages/messages.gateway';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notifRepo: any;
  let pushService: any;
  let gateway: any;

  beforeEach(async () => {
    notifRepo = {
      create: jest.fn().mockImplementation((d) => ({ id: 'n1', ...d })),
      save: jest.fn().mockImplementation((d) => Promise.resolve({ ...d, id: d.id || 'n1' })),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    pushService = {
      isNotificationEnabled: jest.fn().mockResolvedValue(true),
      sendLikeNotification: jest.fn().mockResolvedValue(undefined),
      sendCommentNotification: jest.fn().mockResolvedValue(undefined),
      sendFollowNotification: jest.fn().mockResolvedValue(undefined),
      sendFollowRequestNotification: jest.fn().mockResolvedValue(undefined),
      sendFollowRequestAcceptedNotification: jest.fn().mockResolvedValue(undefined),
      sendToUser: jest.fn().mockResolvedValue(undefined),
    };
    gateway = { emitNewNotification: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notification), useValue: notifRepo },
        { provide: PushNotificationService, useValue: pushService },
        { provide: MessagesGateway, useValue: gateway },
      ],
    }).compile();
    service = module.get<NotificationsService>(NotificationsService);
    (service as any).pushNotificationService = pushService;
    (service as any).messagesGateway = gateway;
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('UT-NOT-01: self-notification guard', () => {
    it('should return null when senderId equals recipientId', async () => {
      expect(await service.createNotification('u1', 'u1', NotificationType.LIKE)).toBeNull();
    });

    it('should proceed when senderId differs from recipientId', async () => {
      const result = await service.createNotification('u2', 'u1', NotificationType.LIKE, 'v1');
      expect(result).toBeDefined();
      expect(notifRepo.save).toHaveBeenCalled();
    });
  });

  describe('createNotification', () => {
    it('should save and emit notification when enabled', async () => {
      const result = await service.createNotification('u2', 'u1', NotificationType.LIKE, 'v1');
      expect(notifRepo.save).toHaveBeenCalled();
      expect(gateway.emitNewNotification).toHaveBeenCalledWith('u2', expect.objectContaining({ type: NotificationType.LIKE }));
      expect(result).toBeDefined();
    });

    it('should send push but not save when in-app notification disabled', async () => {
      pushService.isNotificationEnabled.mockResolvedValue(false);
      const result = await service.createNotification('u2', 'u1', NotificationType.LIKE);
      expect(notifRepo.save).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should handle WebSocket emit error gracefully', async () => {
      gateway.emitNewNotification.mockImplementation(() => { throw new Error('ws fail'); });
      const result = await service.createNotification('u2', 'u1', NotificationType.LIKE);
      expect(result).toBeDefined();
    });

    it('should send LIKE push', async () => {
      await service.createNotification('u2', 'u1', NotificationType.LIKE, 'v1', undefined, undefined, 'Alice');
      expect(pushService.sendLikeNotification).toHaveBeenCalledWith('u2', 'Alice');
    });

    it('should send COMMENT push', async () => {
      await service.createNotification('u2', 'u1', NotificationType.COMMENT, 'v1', 'c1', 'Nice!', 'Alice');
      expect(pushService.sendCommentNotification).toHaveBeenCalledWith('u2', 'Alice', 'Nice!', 'v1');
    });

    it('should send FOLLOW push', async () => {
      await service.createNotification('u2', 'u1', NotificationType.FOLLOW, undefined, undefined, undefined, 'Alice');
      expect(pushService.sendFollowNotification).toHaveBeenCalledWith('u2', 'Alice');
    });

    it('should send FOLLOW_REQUEST push', async () => {
      await service.createNotification('u2', 'u1', NotificationType.FOLLOW_REQUEST, undefined, undefined, undefined, 'Bob');
      expect(pushService.sendFollowRequestNotification).toHaveBeenCalledWith('u2', 'Bob');
    });

    it('should send FOLLOW_REQUEST_ACCEPTED push', async () => {
      await service.createNotification('u2', 'u1', NotificationType.FOLLOW_REQUEST_ACCEPTED, undefined, undefined, undefined, 'Bob');
      expect(pushService.sendFollowRequestAcceptedNotification).toHaveBeenCalledWith('u2', 'Bob');
    });

    it('should send MENTION push via sendToUser', async () => {
      await service.createNotification('u2', 'u1', NotificationType.MENTION, 'v1', undefined, 'mentioned you', 'Alice');
      expect(pushService.sendToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', data: expect.objectContaining({ type: 'mention' }) }));
    });

    it('should send REPLY push via sendToUser', async () => {
      await service.createNotification('u2', 'u1', NotificationType.REPLY, 'v1', undefined, 'replied', 'Alice');
      expect(pushService.sendToUser).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'reply' }) }));
    });

    it('should send generic push for unknown type with message', async () => {
      await service.createNotification('u2', 'u1', 'CUSTOM' as any, 'v1', undefined, 'Custom msg');
      expect(pushService.sendToUser).toHaveBeenCalled();
    });

    it('should not send generic push for unknown type without message', async () => {
      await service.createNotification('u2', 'u1', 'CUSTOM' as any);
      // still saves notification, just no generic push
      expect(notifRepo.save).toHaveBeenCalled();
    });

    it('should handle push notification error gracefully', async () => {
      pushService.sendLikeNotification.mockRejectedValue(new Error('push fail'));
      const result = await service.createNotification('u2', 'u1', NotificationType.LIKE);
      expect(result).toBeDefined();
    });

    it('should use default senderName if not provided', async () => {
      await service.createNotification('u2', 'u1', NotificationType.FOLLOW);
      expect(pushService.sendFollowNotification).toHaveBeenCalledWith('u2', 'Người dùng');
    });
  });

  describe('getNotifications', () => {
    it('should return notifications', async () => {
      notifRepo.find.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);
      const result = await service.getNotifications('u1');
      expect(result).toHaveLength(2);
      expect(notifRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { recipientId: 'u1' } }));
    });

    it('should use default limit of 50', async () => {
      await service.getNotifications('u1');
      expect(notifRepo.find).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count', async () => {
      expect(await service.getUnreadCount('u1')).toBe(3);
    });
  });

  describe('markAsRead', () => {
    it('should mark as read and return true', async () => {
      expect(await service.markAsRead('n1', 'u1')).toBe(true);
    });

    it('should return false if no rows affected', async () => {
      notifRepo.update.mockResolvedValue({ affected: 0 });
      expect(await service.markAsRead('n1', 'u1')).toBe(false);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all as read', async () => {
      await service.markAllAsRead('u1');
      expect(notifRepo.update).toHaveBeenCalledWith({ recipientId: 'u1', isRead: false }, { isRead: true });
    });
  });

  describe('deleteNotification', () => {
    it('should delete and return true', async () => {
      expect(await service.deleteNotification('n1', 'u1')).toBe(true);
    });

    it('should return false if nothing deleted', async () => {
      notifRepo.delete.mockResolvedValue({ affected: 0 });
      expect(await service.deleteNotification('n1', 'u1')).toBe(false);
    });
  });
});

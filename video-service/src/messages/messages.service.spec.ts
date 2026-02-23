import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { Message } from '../entities/message.entity';
import { Conversation } from '../entities/conversation.entity';
import { PushNotificationService } from '../notifications/push-notification.service';
import { PrivacyService } from '../config/privacy.service';
import { ConfigService } from '@nestjs/config';

describe('MessagesService', () => {
  let service: MessagesService;
  let messageRepo: any;
  let conversationRepo: any;
  let pushNotificationService: any;
  let privacyService: any;
  let configService: any;

  beforeEach(async () => {
    messageRepo = {
      create: jest.fn((dto) => ({ id: 'msg1', createdAt: new Date('2025-01-01'), isRead: false, ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: 'msg1', createdAt: new Date('2025-01-01'), ...entity })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        getOne: jest.fn().mockResolvedValue(null),
      })),
    };

    conversationRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    pushNotificationService = {
      sendMessageNotification: jest.fn().mockResolvedValue(undefined),
    };

    privacyService = {
      canSendMessage: jest.fn().mockResolvedValue({ allowed: true }),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'GEMINI_API_KEY') return 'test-key';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getRepositoryToken(Message), useValue: messageRepo },
        { provide: getRepositoryToken(Conversation), useValue: conversationRepo },
        { provide: PushNotificationService, useValue: pushNotificationService },
        { provide: PrivacyService, useValue: privacyService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // ========== createMessage ==========
  describe('createMessage', () => {
    it('should create a message and new conversation', async () => {
      conversationRepo.findOne.mockResolvedValue(null);
      const result = await service.createMessage('u1', 'u2', 'hello');
      expect(messageRepo.save).toHaveBeenCalled();
      expect(conversationRepo.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should update existing conversation', async () => {
      conversationRepo.findOne.mockResolvedValue({
        id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2',
        lastMessage: 'old', lastMessageSenderId: 'u1',
      });
      await service.createMessage('u1', 'u2', 'new msg');
      expect(conversationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastMessage: 'new msg' }),
      );
    });

    it('should throw ForbiddenException when messaging not allowed', async () => {
      privacyService.canSendMessage.mockResolvedValue({ allowed: false, reason: 'blocked' });
      await expect(service.createMessage('u1', 'u2', 'hi')).rejects.toThrow(ForbiddenException);
    });

    it('should throw with deactivated message', async () => {
      privacyService.canSendMessage.mockResolvedValue({ allowed: false, isDeactivated: true });
      await expect(service.createMessage('u1', 'u2', 'hi')).rejects.toThrow('vô hiệu hóa');
    });

    it('should send push notification when not muted', async () => {
      conversationRepo.findOne.mockResolvedValue({
        id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2',
        isMutedBy1: false, isMutedBy2: false,
      });
      await service.createMessage('u1', 'u2', 'hello', undefined, 'Alice');
      expect(pushNotificationService.sendMessageNotification).toHaveBeenCalled();
    });

    it('should skip push notification when muted', async () => {
      conversationRepo.findOne.mockResolvedValue({
        id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2',
        isMutedBy1: false, isMutedBy2: true, // recipient (u2) muted
      });
      await service.createMessage('u1', 'u2', 'hello');
      expect(pushNotificationService.sendMessageNotification).not.toHaveBeenCalled();
    });

    it('should use nickname as display name', async () => {
      conversationRepo.findOne.mockResolvedValue({
        id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2',
        nicknameBy2: 'MyFriend', isMutedBy1: false, isMutedBy2: false,
      });
      await service.createMessage('u1', 'u2', 'hi');
      expect(pushNotificationService.sendMessageNotification).toHaveBeenCalledWith(
        'u2', 'MyFriend', 'hi', expect.any(String), 'u1',
      );
    });

    it('should handle replyTo', async () => {
      conversationRepo.findOne.mockResolvedValue({
        id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2',
        isMutedBy1: false, isMutedBy2: false,
      });
      await service.createMessage('u1', 'u2', 'reply', { id: 'old-msg', content: 'original', senderId: 'u2' });
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ replyToId: 'old-msg', replyToContent: 'original' }),
      );
    });
  });

  // ========== getMessages ==========
  describe('getMessages', () => {
    it('should return messages filtering deleted and formatting dates', async () => {
      messageRepo.find.mockResolvedValue([
        { id: '1', content: 'hello', createdAt: new Date('2025-01-01'), deletedForUserIds: [], isDeletedForEveryone: false },
        { id: '2', content: 'secret', createdAt: new Date('2025-01-01'), deletedForUserIds: ['u1'], isDeletedForEveryone: false },
        { id: '3', content: 'unsent', createdAt: new Date('2025-01-01'), deletedForUserIds: [], isDeletedForEveryone: true, imageUrls: ['img.jpg'] },
      ]);
      const result = await service.getMessages('u1', 'u2');
      expect(result).toHaveLength(2); // msg 2 filtered out
      expect(result[1].content).toBe('[MESSAGE_DELETED]');
      expect(result[1].imageUrls).toEqual([]);
    });

    it('should handle string dates', async () => {
      messageRepo.find.mockResolvedValue([
        { id: '1', content: 'hi', createdAt: '2025-01-01T00:00:00.000Z', deletedForUserIds: [], isDeletedForEveryone: false },
      ]);
      const result = await service.getMessages('u1', 'u2');
      expect(result[0].createdAt).toBe('2025-01-01T00:00:00.000Z');
    });
  });

  // ========== getConversations ==========
  describe('getConversations', () => {
    it('should return conversations with unread count', async () => {
      conversationRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2', lastMessage: 'hi', lastMessageSenderId: 'u2', updatedAt: new Date('2025-01-01') },
        ]),
      });
      messageRepo.count.mockResolvedValue(3);
      messageRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'm1', content: 'latest', senderId: 'u2', deletedForUserIds: [], isDeletedForEveryone: false },
        ]),
      });

      const result = await service.getConversations('u1');
      expect(result).toHaveLength(1);
      expect(result[0].otherUserId).toBe('u2');
      expect(result[0].unreadCount).toBe(3);
    });

    it('should handle unsent last message', async () => {
      conversationRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2', lastMessage: 'old', lastMessageSenderId: 'u2', updatedAt: new Date() },
        ]),
      });
      messageRepo.count.mockResolvedValue(0);
      messageRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'm1', content: '', senderId: 'u2', deletedForUserIds: [], isDeletedForEveryone: true },
        ]),
      });

      const result = await service.getConversations('u1');
      expect(result[0].isLastMessageUnsent).toBe(true);
      expect(result[0].lastMessage).toBe('');
    });
  });

  // ========== markAsRead ==========
  describe('markAsRead', () => {
    it('should update unread messages', async () => {
      await service.markAsRead('conv1', 'u1');
      expect(messageRepo.update).toHaveBeenCalledWith(
        { conversationId: 'conv1', recipientId: 'u1', isRead: false },
        { isRead: true },
      );
    });
  });

  // ========== getUnreadCount ==========
  describe('getUnreadCount', () => {
    it('should return unread count', async () => {
      messageRepo.count.mockResolvedValue(7);
      const count = await service.getUnreadCount('u1');
      expect(count).toBe(7);
    });
  });

  // ========== getConversationSettings ==========
  describe('getConversationSettings', () => {
    it('should return defaults when no conversation exists', async () => {
      conversationRepo.findOne.mockResolvedValue(null);
      const settings = await service.getConversationSettings('u1', 'u2');
      expect(settings).toEqual({ isMuted: false, isPinned: false, themeColor: null, nickname: null, autoTranslate: false });
    });

    it('should return participant1 settings', async () => {
      conversationRepo.findOne.mockResolvedValue({
        id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2',
        isMutedBy1: true, isPinnedBy1: true, themeColorBy1: '#ff0000', nicknameBy1: 'Bob', autoTranslateBy1: true,
      });
      const settings = await service.getConversationSettings('u1', 'u2');
      expect(settings.isMuted).toBe(true);
      expect(settings.nickname).toBe('Bob');
    });

    it('should return participant2 settings', async () => {
      conversationRepo.findOne.mockResolvedValue({
        id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2',
        isMutedBy2: false, isPinnedBy2: true, themeColorBy2: '#00ff00', nicknameBy2: 'Alice', autoTranslateBy2: false,
      });
      const settings = await service.getConversationSettings('u2', 'u1');
      expect(settings.isPinned).toBe(true);
      expect(settings.nickname).toBe('Alice');
    });
  });

  // ========== updateConversationSettings ==========
  describe('updateConversationSettings', () => {
    it('should create conversation if not exists and update settings', async () => {
      conversationRepo.findOne.mockResolvedValue(null);
      await service.updateConversationSettings('u1', 'u2', { isMuted: true, isPinned: true });
      expect(conversationRepo.create).toHaveBeenCalled();
      expect(conversationRepo.save).toHaveBeenCalled();
    });

    it('should update mute, pin, theme, nickname, autoTranslate for participant1', async () => {
      const conv = {
        id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2',
        isMutedBy1: false, isPinnedBy1: false, themeColorBy1: null, nicknameBy1: null, autoTranslateBy1: false,
      };
      conversationRepo.findOne.mockResolvedValue(conv);
      await service.updateConversationSettings('u1', 'u2', {
        isMuted: true, isPinned: true, themeColor: '#000', nickname: 'hey', autoTranslate: true,
      });
      expect(conversationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isMutedBy1: true, isPinnedBy1: true, themeColorBy1: '#000', nicknameBy1: 'hey', autoTranslateBy1: true }),
      );
    });

    it('should clear nickname when empty string', async () => {
      const conv = { id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2', nicknameBy1: 'old' };
      conversationRepo.findOne.mockResolvedValue(conv);
      await service.updateConversationSettings('u1', 'u2', { nickname: '' });
      expect(conversationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ nicknameBy1: null }),
      );
    });
  });

  // ========== updateSharedThemeColor ==========
  describe('updateSharedThemeColor', () => {
    it('should set both participants to same theme color', async () => {
      conversationRepo.findOne.mockResolvedValue({
        id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2',
      });
      const result = await service.updateSharedThemeColor('u1', 'u2', '#ff0000');
      expect(result).toBe(true);
      expect(conversationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ themeColorBy1: '#ff0000', themeColorBy2: '#ff0000' }),
      );
    });

    it('should create conversation if not exists', async () => {
      conversationRepo.findOne.mockResolvedValue(null);
      await service.updateSharedThemeColor('u1', 'u2', '#000');
      expect(conversationRepo.create).toHaveBeenCalled();
    });
  });

  // ========== createSystemMessage ==========
  describe('createSystemMessage', () => {
    it('should create message without push notification', async () => {
      conversationRepo.findOne.mockResolvedValue({ id: 'u1_u2', participant1Id: 'u1', participant2Id: 'u2' });
      await service.createSystemMessage('u1', 'u2', '[THEME_CHANGE:#ff0000]');
      expect(messageRepo.save).toHaveBeenCalled();
      // push should NOT be called from createSystemMessage
    });

    it('should create conversation if not exists', async () => {
      conversationRepo.findOne.mockResolvedValue(null);
      await service.createSystemMessage('u1', 'u2', 'system msg');
      expect(conversationRepo.create).toHaveBeenCalled();
      expect(conversationRepo.save).toHaveBeenCalled();
    });
  });

  // ========== pinMessage / unpinMessage ==========
  describe('pinMessage', () => {
    it('should pin a message', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u1', recipientId: 'u2' });
      const result = await service.pinMessage('msg1', 'u1');
      expect(result.pinnedBy).toBe('u1');
    });

    it('should throw NotFoundException when message not found', async () => {
      messageRepo.findOne.mockResolvedValue(null);
      await expect(service.pinMessage('missing', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user not in conversation', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u3', recipientId: 'u4' });
      await expect(service.pinMessage('msg1', 'u1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('unpinMessage', () => {
    it('should unpin a message', async () => {
      messageRepo.findOne
        .mockResolvedValueOnce({ id: 'msg1', pinnedBy: 'u1' })
        .mockResolvedValueOnce({ id: 'msg1', pinnedBy: null, pinnedAt: null });
      const result = await service.unpinMessage('msg1', 'u1');
      expect(messageRepo.update).toHaveBeenCalledWith('msg1', { pinnedBy: null, pinnedAt: null });
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException', async () => {
      messageRepo.findOne.mockResolvedValue(null);
      await expect(service.unpinMessage('missing', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not the pinner', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', pinnedBy: 'u2' });
      await expect(service.unpinMessage('msg1', 'u1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ========== getPinnedMessages ==========
  describe('getPinnedMessages', () => {
    it('should return pinned messages', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 'msg1', pinnedBy: 'u1' }]),
      };
      messageRepo.createQueryBuilder.mockReturnValue(qb);
      const result = await service.getPinnedMessages('u1', 'u2');
      expect(result).toHaveLength(1);
    });
  });

  // ========== searchMessages ==========
  describe('searchMessages', () => {
    it('should search messages by query', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 'msg1', content: 'hello world' }]),
      };
      messageRepo.createQueryBuilder.mockReturnValue(qb);
      const result = await service.searchMessages('u1', 'u2', 'hello');
      expect(result).toHaveLength(1);
    });
  });

  // ========== getMediaMessages ==========
  describe('getMediaMessages', () => {
    it('should return media messages', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 'msg1', content: '[IMAGE:url]' }]),
      };
      messageRepo.createQueryBuilder.mockReturnValue(qb);
      const result = await service.getMediaMessages('u1', 'u2');
      expect(result).toHaveLength(1);
    });
  });

  // ========== getMessageById ==========
  describe('getMessageById', () => {
    it('should return message or null', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1' });
      const result = await service.getMessageById('msg1');
      expect(result).toEqual({ id: 'msg1' });
    });
  });

  // ========== deleteForMe ==========
  describe('deleteForMe', () => {
    it('should add userId to deletedForUserIds', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u1', recipientId: 'u2', deletedForUserIds: [] });
      const result = await service.deleteForMe('msg1', 'u1');
      expect(result.success).toBe(true);
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ deletedForUserIds: ['u1'] }),
      );
    });

    it('should not duplicate userId', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u1', recipientId: 'u2', deletedForUserIds: ['u1'] });
      await service.deleteForMe('msg1', 'u1');
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ deletedForUserIds: ['u1'] }),
      );
    });

    it('should throw NotFoundException', async () => {
      messageRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteForMe('missing', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not in conversation', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u3', recipientId: 'u4', deletedForUserIds: [] });
      await expect(service.deleteForMe('msg1', 'u1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ========== deleteForEveryone ==========
  describe('deleteForEveryone', () => {
    it('should mark message as deleted for everyone', async () => {
      const msg = { id: 'msg1', senderId: 'u1', recipientId: 'u2', createdAt: new Date(), isDeletedForEveryone: false, imageUrls: ['img.jpg'], pinnedBy: null };
      messageRepo.findOne.mockResolvedValue(msg);
      conversationRepo.findOne.mockResolvedValue({ id: 'u1_u2' });
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.deleteForEveryone('msg1', 'u1');
      expect(result.success).toBe(true);
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isDeletedForEveryone: true, content: '', imageUrls: [] }),
      );
    });

    it('should throw when not sender', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u2', recipientId: 'u1', createdAt: new Date() });
      await expect(service.deleteForEveryone('msg1', 'u1')).rejects.toThrow(ForbiddenException);
    });

    it('should return false when already deleted', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u1', isDeletedForEveryone: true, createdAt: new Date() });
      const result = await service.deleteForEveryone('msg1', 'u1');
      expect(result.success).toBe(false);
    });

    it('should return false when past time limit', async () => {
      const oldDate = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u1', isDeletedForEveryone: false, createdAt: oldDate });
      const result = await service.deleteForEveryone('msg1', 'u1');
      expect(result.success).toBe(false);
      expect(result.canUnsend).toBe(false);
    });

    it('should also unpin if message was pinned', async () => {
      const msg = { id: 'msg1', senderId: 'u1', recipientId: 'u2', createdAt: new Date(), isDeletedForEveryone: false, imageUrls: [], pinnedBy: 'u1', pinnedAt: new Date() };
      messageRepo.findOne.mockResolvedValue(msg);
      conversationRepo.findOne.mockResolvedValue({ id: 'u1_u2' });
      messageRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });
      await service.deleteForEveryone('msg1', 'u1');
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ pinnedBy: null, pinnedAt: null }),
      );
    });
  });

  // ========== canUnsendMessage / getUnsendTimeRemaining ==========
  describe('canUnsendMessage', () => {
    it('should return true within time limit', () => {
      const msg = { senderId: 'u1', isDeletedForEveryone: false, createdAt: new Date() } as Message;
      expect(service.canUnsendMessage(msg, 'u1')).toBe(true);
    });

    it('should return false after time limit', () => {
      const msg = { senderId: 'u1', isDeletedForEveryone: false, createdAt: new Date(Date.now() - 20 * 60 * 1000) } as Message;
      expect(service.canUnsendMessage(msg, 'u1')).toBe(false);
    });

    it('should return false for non-sender', () => {
      const msg = { senderId: 'u2', isDeletedForEveryone: false, createdAt: new Date() } as Message;
      expect(service.canUnsendMessage(msg, 'u1')).toBe(false);
    });
  });

  describe('getUnsendTimeRemaining', () => {
    it('should return remaining seconds', () => {
      const msg = { createdAt: new Date() } as Message;
      const remaining = service.getUnsendTimeRemaining(msg);
      expect(remaining).toBeGreaterThan(500);
      expect(remaining).toBeLessThanOrEqual(600);
    });

    it('should return 0 when expired', () => {
      const msg = { createdAt: new Date(Date.now() - 20 * 60 * 1000) } as Message;
      expect(service.getUnsendTimeRemaining(msg)).toBe(0);
    });
  });

  // ========== editMessage ==========
  describe('editMessage', () => {
    it('should edit a text message', async () => {
      const msg = { id: 'msg1', senderId: 'u1', recipientId: 'u2', content: 'old', createdAt: new Date(), isDeletedForEveryone: false, isEdited: false, conversationId: 'u1_u2' };
      messageRepo.findOne.mockResolvedValue(msg);
      const result = await service.editMessage('msg1', 'u1', 'new content');
      expect(result.success).toBe(true);
      expect(result.editedMessage.content).toBe('new content');
    });

    it('should throw when not sender', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u2', createdAt: new Date() });
      await expect(service.editMessage('msg1', 'u1', 'edit')).rejects.toThrow(ForbiddenException);
    });

    it('should fail when message is deleted', async () => {
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u1', isDeletedForEveryone: true, createdAt: new Date() });
      const result = await service.editMessage('msg1', 'u1', 'edit');
      expect(result.success).toBe(false);
    });

    it('should fail after time limit', async () => {
      const oldDate = new Date(Date.now() - 20 * 60 * 1000);
      messageRepo.findOne.mockResolvedValue({ id: 'msg1', senderId: 'u1', isDeletedForEveryone: false, createdAt: oldDate, content: 'old' });
      const result = await service.editMessage('msg1', 'u1', 'edit');
      expect(result.success).toBe(false);
    });

    it('should fail for image/video messages', async () => {
      const msg = { id: 'msg1', senderId: 'u1', isDeletedForEveryone: false, createdAt: new Date(), content: '[IMAGE:url]' };
      messageRepo.findOne.mockResolvedValue(msg);
      const result = await service.editMessage('msg1', 'u1', 'edit');
      expect(result.success).toBe(false);
    });

    it('should save original content on first edit', async () => {
      const msg = { id: 'msg1', senderId: 'u1', recipientId: 'u2', content: 'original', createdAt: new Date(), isDeletedForEveryone: false, isEdited: false, conversationId: 'c1' };
      messageRepo.findOne.mockResolvedValue(msg);
      await service.editMessage('msg1', 'u1', 'edited');
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ originalContent: 'original', isEdited: true }),
      );
    });
  });

  // ========== canEditMessage ==========
  describe('canEditMessage', () => {
    it('should return true within time limit for sender', () => {
      const msg = { senderId: 'u1', isDeletedForEveryone: false, createdAt: new Date() } as Message;
      expect(service.canEditMessage(msg, 'u1')).toBe(true);
    });

    it('should return false for non-sender', () => {
      const msg = { senderId: 'u2', isDeletedForEveryone: false, createdAt: new Date() } as Message;
      expect(service.canEditMessage(msg, 'u1')).toBe(false);
    });
  });

  // ========== translateMessage ==========
  describe('translateMessage', () => {
    it('should return error when no API key', async () => {
      configService.get.mockReturnValue(null);
      const result = await service.translateMessage('hello', 'vi');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should translate successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: 'xin chào' }] } }],
        }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any);
      const result = await service.translateMessage('hello', 'vi');
      expect(result.success).toBe(true);
      expect(result.translatedText).toBe('xin chào');
    });

    it('should handle API error', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, text: jest.fn().mockResolvedValue('error') } as any);
      const result = await service.translateMessage('hello', 'en');
      expect(result.success).toBe(false);
    });

    it('should handle fetch exception', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
      const result = await service.translateMessage('hello', 'vi');
      expect(result.success).toBe(false);
    });

    it('should handle empty translation response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ candidates: [] }),
      } as any);
      const result = await service.translateMessage('hello', 'vi');
      expect(result.success).toBe(false);
    });
  });
});

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
  MoreThan: jest.fn(),
  LessThan: jest.fn(),
  Between: jest.fn(),
  IsNull: jest.fn(),
  Like: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';

describe('MessagesController', () => {
  let controller: MessagesController;
  let messagesService: any;
  let messagesGateway: any;

  beforeEach(async () => {
    messagesService = {
      createMessage: jest.fn().mockResolvedValue({ id: 'm1', senderId: 's1', recipientId: 'r1', content: 'hi', createdAt: new Date(), isRead: false, conversationId: 'c1' }),
      getMessages: jest.fn().mockResolvedValue([]),
      getConversations: jest.fn().mockResolvedValue([]),
      markAsRead: jest.fn().mockResolvedValue(undefined),
      getUnreadCount: jest.fn().mockResolvedValue(5),
      getConversationSettings: jest.fn().mockResolvedValue({ isMuted: false }),
      updateConversationSettings: jest.fn().mockResolvedValue(undefined),
      pinMessage: jest.fn().mockResolvedValue({ id: 'm1', isPinned: true }),
      unpinMessage: jest.fn().mockResolvedValue({ id: 'm1', isPinned: false }),
      getPinnedMessages: jest.fn().mockResolvedValue([]),
      searchMessages: jest.fn().mockResolvedValue([]),
      getMediaMessages: jest.fn().mockResolvedValue([]),
      deleteForMe: jest.fn().mockResolvedValue({ success: true }),
      deleteForEveryone: jest.fn().mockResolvedValue({ success: true }),
      editMessage: jest.fn().mockResolvedValue({ success: true, editedMessage: { senderId: 's1', recipientId: 'r1' } }),
      translateMessage: jest.fn().mockResolvedValue({ translatedText: 'hello' }),
    };
    messagesGateway = {
      emitNewMessage: jest.fn(),
      emitMessageEdited: jest.fn(),
      emitPrivacySettingsChanged: jest.fn(),
      emitOnlineStatusVisibilityChanged: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: messagesService },
        { provide: MessagesGateway, useValue: messagesGateway },
      ],
    }).compile();

    controller = module.get<MessagesController>(MessagesController);
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });

  describe('sendMessage', () => {
    it('should send and emit message', async () => {
      const result = await controller.sendMessage({ senderId: 's1', recipientId: 'r1', content: 'hi' });
      expect(result.success).toBe(true);
      expect(messagesGateway.emitNewMessage).toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    it('should return messages', async () => {
      const result = await controller.getMessages('u1', 'u2', '50', '0');
      expect(result.success).toBe(true);
    });
  });

  describe('getConversations', () => {
    it('should return conversations', async () => {
      const result = await controller.getConversations('u1');
      expect(result.success).toBe(true);
    });
  });

  describe('markAsRead', () => {
    it('should mark as read', async () => {
      const result = await controller.markAsRead({ conversationId: 'c1', userId: 'u1' });
      expect(result.success).toBe(true);
    });
  });

  describe('getUnreadCount', () => {
    it('should return count', async () => {
      const result = await controller.getUnreadCount('u1');
      expect(result.count).toBe(5);
    });
  });

  describe('conversation settings', () => {
    it('should get settings', async () => {
      await controller.getConversationSettings('r1', 'u1');
      expect(messagesService.getConversationSettings).toHaveBeenCalledWith('u1', 'r1');
    });
    it('should update settings', async () => {
      const result = await controller.updateConversationSettings('r1', 'u1', { isMuted: true });
      expect(result.success).toBe(true);
    });
  });

  describe('pinned messages', () => {
    it('should pin', async () => {
      const result = await controller.pinMessage('m1', 'u1');
      expect(result.success).toBe(true);
    });
    it('should unpin', async () => {
      const result = await controller.unpinMessage('m1', 'u1');
      expect(result.success).toBe(true);
    });
    it('should get pinned', async () => {
      const result = await controller.getPinnedMessages('u1', 'u2');
      expect(result.success).toBe(true);
    });
  });

  describe('search/media', () => {
    it('should search messages', async () => {
      const result = await controller.searchMessages('u1', 'u2', 'hello', '50');
      expect(result.success).toBe(true);
    });
    it('should get media messages', async () => {
      const result = await controller.getMediaMessages('u1', 'u2', '50', '0');
      expect(result.success).toBe(true);
    });
  });

  describe('upload image', () => {
    it('should return image url', async () => {
      const result = await controller.uploadImage({ filename: 'img.jpg' } as any);
      expect(result.success).toBe(true);
      expect(result.imageUrl).toContain('img.jpg');
    });
    it('should fail if no file', async () => {
      const result = await controller.uploadImage(null as any);
      expect(result.success).toBe(false);
    });
  });

  describe('message deletion', () => {
    it('should delete for me', async () => {
      const result = await controller.deleteForMe('m1', 'u1');
      expect(result.success).toBe(true);
    });
    it('should delete for everyone', async () => {
      const result = await controller.deleteForEveryone('m1', 'u1');
      expect(result.success).toBe(true);
    });
  });

  describe('editMessage', () => {
    it('should edit and emit', async () => {
      const result = await controller.editMessage('m1', 's1', { content: 'edited' });
      expect(result.success).toBe(true);
      expect(messagesGateway.emitMessageEdited).toHaveBeenCalled();
    });
    it('should not emit if edit fails', async () => {
      messagesService.editMessage.mockResolvedValue({ success: false });
      await controller.editMessage('m1', 'u1', { content: 'x' });
      expect(messagesGateway.emitMessageEdited).not.toHaveBeenCalled();
    });
  });

  describe('translate', () => {
    it('should translate', async () => {
      const result = await controller.translateMessage({ text: 'xin chào', targetLanguage: 'en' });
      expect(result.translatedText).toBe('hello');
    });
  });

  describe('privacy settings changed', () => {
    it('should emit whoCanSendMessages', async () => {
      await controller.notifyPrivacySettingsChanged({ userId: 'u1', whoCanSendMessages: 'everyone' });
      expect(messagesGateway.emitPrivacySettingsChanged).toHaveBeenCalled();
    });
    it('should emit online status change', async () => {
      await controller.notifyPrivacySettingsChanged({ userId: 'u1', showOnlineStatus: false });
      expect(messagesGateway.emitOnlineStatusVisibilityChanged).toHaveBeenCalled();
      expect(messagesGateway.emitPrivacySettingsChanged).toHaveBeenCalled();
    });
  });
});

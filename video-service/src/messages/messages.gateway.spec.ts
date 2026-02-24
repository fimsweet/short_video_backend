import { MessagesGateway } from './messages.gateway';
import { Server, Socket } from 'socket.io';

describe('MessagesGateway', () => {
  let gateway: MessagesGateway;
  let messagesService: any;
  let configService: any;
  let server: any;

  beforeEach(() => {
    messagesService = {
      createMessage: jest.fn().mockResolvedValue({
        id: 'msg1', senderId: 'u1', recipientId: 'u2', content: 'hello',
        createdAt: new Date('2025-01-01'), isRead: false, conversationId: 'u1_u2',
      }),
      markAsRead: jest.fn().mockResolvedValue(undefined),
      deleteForEveryone: jest.fn().mockResolvedValue({ success: true }),
      getMessageById: jest.fn().mockResolvedValue({ id: 'msg1', senderId: 'u1', recipientId: 'u2' }),
      editMessage: jest.fn().mockResolvedValue({ success: true, editedMessage: { id: 'msg1', senderId: 'u1', recipientId: 'u2', content: 'edited' } }),
      updateSharedThemeColor: jest.fn().mockResolvedValue(true),
      createSystemMessage: jest.fn().mockResolvedValue({
        id: 'msg2', senderId: 'u1', recipientId: 'u2', content: '[THEME_CHANGE:#ff0000]',
        createdAt: new Date('2025-01-01'), isRead: false, conversationId: 'u1_u2',
      }),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'USER_SERVICE_URL') return 'http://localhost:3000';
        return null;
      }),
    };

    gateway = new MessagesGateway(messagesService, configService);

    server = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    gateway.server = server as any;

    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('afterInit', () => {
    it('should log initialization', () => {
      gateway.afterInit();
      expect(console.log).toHaveBeenCalledWith('WebSocket Gateway initialized');
    });
  });

  describe('handleConnection', () => {
    it('should log client connection', () => {
      const client = { id: 'socket1' } as Socket;
      gateway.handleConnection(client);
      expect(console.log).toHaveBeenCalledWith('Client connected: socket1');
    });
  });

  describe('handleDisconnect', () => {
    it('should clean up user socket and broadcast offline', async () => {
      const client = { id: 'socket1', join: jest.fn() } as any;
      // First join
      await gateway.handleJoin(client, { userId: 'u1' });
      // Then disconnect
      gateway.handleDisconnect(client as Socket);
      expect(server.to).toHaveBeenCalled();
    });

    it('should handle disconnect for unknown socket', () => {
      const client = { id: 'unknown' } as Socket;
      gateway.handleDisconnect(client);
      // Should not throw
    });
  });

  describe('UT-GW-01: Identity context establishment via join event', () => {
    describe('handleJoin', () => {
      it('should register user socket and return success', async () => {
        const client = { id: 'socket1', join: jest.fn() } as any;
        // Mock fetch for showOnlineStatus
        jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue({ settings: { showOnlineStatus: true } }),
        } as any);
        const result = await gateway.handleJoin(client, { userId: 'u1' });
        expect(result).toEqual({ success: true });
        expect(client.join).toHaveBeenCalledWith('user_u1');
      });

      it('should return error when no userId', async () => {
        const client = { id: 'socket1' } as any;
        const result = await gateway.handleJoin(client, { userId: '' });
        expect(result).toEqual({ success: false, error: 'userId required' });
      });

      it('should handle fetch error for showOnlineStatus', async () => {
        const client = { id: 'socket1', join: jest.fn() } as any;
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
        const result = await gateway.handleJoin(client, { userId: 'u1' });
        expect(result).toEqual({ success: true });
      });

      it('should add user to hidden set when showOnlineStatus=false', async () => {
        const client = { id: 'socket1', join: jest.fn() } as any;
        jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue({ settings: { showOnlineStatus: false } }),
        } as any);
        await gateway.handleJoin(client, { userId: 'u1' });
        // The user's online status should show as offline
        const status = gateway.handleGetOnlineStatus({ userId: 'u1' });
        expect(status.isOnline).toBe(false);
      });
    });
  });

  describe('handleGetOnlineStatus', () => {
    it('should return online for connected user', async () => {
      const client = { id: 'socket1', join: jest.fn() } as any;
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as any);
      await gateway.handleJoin(client, { userId: 'u1' });
      const result = gateway.handleGetOnlineStatus({ userId: 'u1' });
      expect(result.isOnline).toBe(true);
    });

    it('should return offline for unknown user', () => {
      const result = gateway.handleGetOnlineStatus({ userId: 'unknown' });
      expect(result.isOnline).toBe(false);
    });
  });

  describe('handleGetMultipleOnlineStatus', () => {
    it('should return statuses for multiple users', async () => {
      const client = { id: 'socket1', join: jest.fn() } as any;
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as any);
      await gateway.handleJoin(client, { userId: 'u1' });
      const result = gateway.handleGetMultipleOnlineStatus({ userIds: ['u1', 'u2'] });
      expect(result.statuses).toHaveLength(2);
      expect(result.statuses[0].isOnline).toBe(true);
      expect(result.statuses[1].isOnline).toBe(false);
    });
  });

  describe('handleSubscribeOnlineStatus', () => {
    it('should join the status room and emit current status', () => {
      const client = { join: jest.fn(), emit: jest.fn() } as any;
      const result = gateway.handleSubscribeOnlineStatus(client, { userId: 'u1' });
      expect(client.join).toHaveBeenCalledWith('online_status_u1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('handleUnsubscribeOnlineStatus', () => {
    it('should leave the status room', () => {
      const client = { leave: jest.fn() } as any;
      const result = gateway.handleUnsubscribeOnlineStatus(client, { userId: 'u1' });
      expect(client.leave).toHaveBeenCalledWith('online_status_u1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('handleMessage', () => {
    it('should create message and emit to both users', async () => {
      const result = await gateway.handleMessage({ senderId: 'u1', recipientId: 'u2', content: 'hello' });
      expect(result.success).toBe(true);
      expect(server.to).toHaveBeenCalledWith('user_u2');
      expect(server.to).toHaveBeenCalledWith('user_u1');
    });

    it('should return error on failure', async () => {
      messagesService.createMessage.mockRejectedValue(new Error('fail'));
      const result = await gateway.handleMessage({ senderId: 'u1', recipientId: 'u2', content: 'hello' });
      expect(result.success).toBe(false);
    });
  });

  describe('handleMarkAsRead', () => {
    it('should mark as read and notify other user', async () => {
      const result = await gateway.handleMarkAsRead({ conversationId: 'u1_u2', userId: 'u1' });
      expect(result).toEqual({ success: true });
      expect(server.to).toHaveBeenCalledWith('user_u2');
    });

    it('should handle error', async () => {
      messagesService.markAsRead.mockRejectedValue(new Error('fail'));
      const result = await gateway.handleMarkAsRead({ conversationId: 'u1_u2', userId: 'u1' });
      expect(result.success).toBe(false);
    });
  });

  describe('handleTyping', () => {
    it('should emit typing status to recipient', () => {
      const result = gateway.handleTyping({ senderId: 'u1', recipientId: 'u2', isTyping: true });
      expect(server.to).toHaveBeenCalledWith('user_u2');
      expect(result).toEqual({ success: true });
    });
  });

  describe('handleUnsendMessage', () => {
    it('should unsend and notify both users', async () => {
      const result = await gateway.handleUnsendMessage({ messageId: 'msg1', userId: 'u1' });
      expect(result.success).toBe(true);
      expect(server.to).toHaveBeenCalledWith('user_u2');
    });

    it('should handle error', async () => {
      messagesService.deleteForEveryone.mockRejectedValue(new Error('fail'));
      const result = await gateway.handleUnsendMessage({ messageId: 'msg1', userId: 'u1' });
      expect(result.success).toBe(false);
    });
  });

  describe('handleEditMessage', () => {
    it('should edit and notify both users', async () => {
      const result = await gateway.handleEditMessage({ messageId: 'msg1', userId: 'u1', content: 'edited' });
      expect(result.success).toBe(true);
    });

    it('should handle error', async () => {
      messagesService.editMessage.mockRejectedValue(new Error('fail'));
      const result = await gateway.handleEditMessage({ messageId: 'msg1', userId: 'u1', content: 'edited' });
      expect(result.success).toBe(false);
    });
  });

  describe('handleChangeThemeColor', () => {
    it('should change theme, create system message, and emit events', async () => {
      const result = await gateway.handleChangeThemeColor({
        senderId: 'u1', recipientId: 'u2', themeColor: '#ff0000',
      });
      expect(result.success).toBe(true);
      expect(messagesService.updateSharedThemeColor).toHaveBeenCalled();
      expect(messagesService.createSystemMessage).toHaveBeenCalled();
    });

    it('should handle error', async () => {
      messagesService.updateSharedThemeColor.mockRejectedValue(new Error('fail'));
      const result = await gateway.handleChangeThemeColor({
        senderId: 'u1', recipientId: 'u2', themeColor: '#ff0000',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('emitNewMessage', () => {
    it('should emit to both users', () => {
      gateway.emitNewMessage('u2', 'u1', { id: 'msg1' });
      expect(server.to).toHaveBeenCalledWith('user_u2');
      expect(server.to).toHaveBeenCalledWith('user_u1');
    });
  });

  describe('emitMessageEdited', () => {
    it('should emit to both users', () => {
      gateway.emitMessageEdited('u2', 'u1', { id: 'msg1' });
      expect(server.to).toHaveBeenCalledWith('user_u2');
      expect(server.to).toHaveBeenCalledWith('user_u1');
    });
  });

  describe('emitPrivacySettingsChanged', () => {
    it('should broadcast to all', () => {
      gateway.emitPrivacySettingsChanged('u1', { whoCanSendMessages: 'everyone' });
      expect(server.emit).toHaveBeenCalledWith('privacySettingsChanged', expect.objectContaining({ userId: 'u1' }));
    });
  });

  describe('emitNewNotification', () => {
    it('should emit to recipient', () => {
      gateway.emitNewNotification('u2', { type: 'like' });
      expect(server.to).toHaveBeenCalledWith('user_u2');
    });
  });

  describe('emitOnlineStatusVisibilityChanged', () => {
    it('should hide user when showOnlineStatus=false', async () => {
      // First make user online
      const client = { id: 'socket1', join: jest.fn() } as any;
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as any);
      await gateway.handleJoin(client, { userId: 'u1' });

      gateway.emitOnlineStatusVisibilityChanged('u1', false);
      const status = gateway.handleGetOnlineStatus({ userId: 'u1' });
      expect(status.isOnline).toBe(false);
    });

    it('should show user when showOnlineStatus=true', async () => {
      const client = { id: 'socket1', join: jest.fn() } as any;
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as any);
      await gateway.handleJoin(client, { userId: 'u1' });

      // First hide
      gateway.emitOnlineStatusVisibilityChanged('u1', false);
      // Then show
      gateway.emitOnlineStatusVisibilityChanged('u1', true);
      const status = gateway.handleGetOnlineStatus({ userId: 'u1' });
      expect(status.isOnline).toBe(true);
    });
  });
});

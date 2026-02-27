import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessagesService } from './messages.service';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
})
export class MessagesGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  
  // Track user sockets: userId -> Set of socket IDs
  private userSockets: Map<string, Set<string>> = new Map();
  
  // Track online users: userId -> last activity timestamp
  private onlineUsers: Map<string, Date> = new Map();

  // Track users who have hidden their online status (showOnlineStatus = false)
  private hiddenStatusUsers: Set<string> = new Set();

  constructor(
    private messagesService: MessagesService,
    private configService: ConfigService,
  ) {}

  afterInit() {
    console.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    let disconnectedUserId: string | null = null;
    
    this.userSockets.forEach((sockets, userId) => {
      if (sockets.delete(client.id)) {
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
          // Keep lastSeen timestamp before removing from onlineUsers
          const lastSeenDate = this.onlineUsers.get(userId) || new Date();
          this.onlineUsers.set(userId, lastSeenDate);
          disconnectedUserId = userId;
        }
      }
    });
    
    // Broadcast offline status if user has no more connected sockets
    if (disconnectedUserId) {
      this.broadcastOnlineStatus(disconnectedUserId, false);
      console.log(`User ${disconnectedUserId} is now offline`);
    }
    
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join')
  async handleJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { userId: string }) {
    if (!data.userId) {
      return { success: false, error: 'userId required' };
    }

    const wasOffline = !this.userSockets.has(data.userId) || this.userSockets.get(data.userId)?.size === 0;

    if (!this.userSockets.has(data.userId)) {
      this.userSockets.set(data.userId, new Set());
    }

    const userSocketSet = this.userSockets.get(data.userId);
    if (userSocketSet) {
      userSocketSet.add(client.id);
    }

    // Update online status
    this.onlineUsers.set(data.userId, new Date());

    client.join(`user_${data.userId}`);
    console.log(`User ${data.userId} joined with socket ${client.id}`);
    
    // Check user's showOnlineStatus setting from user-service on first connect
    // This ensures hiddenStatusUsers is repopulated after server restart
    if (wasOffline && !this.hiddenStatusUsers.has(data.userId)) {
      try {
        const showOnlineStatus = await this.fetchUserShowOnlineStatus(data.userId);
        if (!showOnlineStatus) {
          this.hiddenStatusUsers.add(data.userId);
          console.log(`User ${data.userId} has showOnlineStatus=false, added to hidden set`);
        }
      } catch (error) {
        console.error(`Failed to check showOnlineStatus for user ${data.userId}:`, error);
      }
    }

    // Broadcast online status if user just came online
    if (wasOffline) {
      this.broadcastOnlineStatus(data.userId, true);
      console.log(`User ${data.userId} is now online`);
    }
    
    return { success: true };
  }

  // Fetch user's showOnlineStatus setting from user-service
  private async fetchUserShowOnlineStatus(userId: string): Promise<boolean> {
    try {
      const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
      const response = await fetch(`${userServiceUrl}/users/privacy/${userId}`);
      if (response.ok) {
        const data = await response.json();
        return data.settings?.showOnlineStatus !== false;
      }
    } catch (error) {
      console.error(`Failed to fetch showOnlineStatus for user ${userId}:`, error);
    }
    return true; // Default to showing online status if fetch fails
  }

  // Broadcast user online/offline status to subscribers and globally
  private broadcastOnlineStatus(userId: string, isOnline: boolean) {
    // If user has hidden their online status, always broadcast as offline
    if (this.hiddenStatusUsers.has(userId) && isOnline) {
      return; // Don't broadcast "online" for hidden users
    }
    const payload = {
      userId,
      isOnline,
      timestamp: new Date().toISOString(),
      lastSeen: this.onlineUsers.get(userId)?.toISOString() || new Date().toISOString(),
    };
    // Emit to subscribers of this user's online status
    this.server.to(`online_status_${userId}`).emit('userOnlineStatus', payload);
    // Also emit globally for inbox screen
    this.server.emit('userOnlineStatus', payload);
  }

  // Get online status of a specific user
  @SubscribeMessage('getOnlineStatus')
  handleGetOnlineStatus(@MessageBody() data: { userId: string }) {
    // If user has hidden their online status, always return offline
    if (this.hiddenStatusUsers.has(data.userId)) {
      return {
        success: true,
        userId: data.userId,
        isOnline: false,
        lastSeen: null,
      };
    }

    const isOnline = this.onlineUsers.has(data.userId) && 
                     this.userSockets.has(data.userId) && 
                     (this.userSockets.get(data.userId)?.size || 0) > 0;
    
    return {
      success: true,
      userId: data.userId,
      isOnline,
      lastSeen: this.onlineUsers.get(data.userId)?.toISOString() || null,
    };
  }

  // Get online status of multiple users
  @SubscribeMessage('getMultipleOnlineStatus')
  handleGetMultipleOnlineStatus(@MessageBody() data: { userIds: string[] }) {
    const statuses = data.userIds.map(userId => {
      // If user has hidden their online status, always return offline
      if (this.hiddenStatusUsers.has(userId)) {
        return {
          userId,
          isOnline: false,
          lastSeen: null,
        };
      }
      const isOnline = this.onlineUsers.has(userId) && 
                       this.userSockets.has(userId) && 
                       (this.userSockets.get(userId)?.size || 0) > 0;
      return {
        userId,
        isOnline,
        lastSeen: this.onlineUsers.get(userId)?.toISOString() || null,
      };
    });
    
    return { success: true, statuses };
  }

  // Subscribe to a user's online status
  @SubscribeMessage('subscribeOnlineStatus')
  handleSubscribeOnlineStatus(@ConnectedSocket() client: Socket, @MessageBody() data: { userId: string }) {
    client.join(`online_status_${data.userId}`);
    
    // If user has hidden their online status, always return offline
    if (this.hiddenStatusUsers.has(data.userId)) {
      client.emit('userOnlineStatus', {
        userId: data.userId,
        isOnline: false,
        timestamp: new Date().toISOString(),
        lastSeen: null,
      });
      return { success: true };
    }

    // Send current status immediately
    const isOnline = this.onlineUsers.has(data.userId) && 
                     this.userSockets.has(data.userId) && 
                     (this.userSockets.get(data.userId)?.size || 0) > 0;
    
    client.emit('userOnlineStatus', {
      userId: data.userId,
      isOnline,
      timestamp: new Date().toISOString(),
      lastSeen: this.onlineUsers.get(data.userId)?.toISOString() || null,
    });
    
    return { success: true };
  }

  // Unsubscribe from a user's online status
  @SubscribeMessage('unsubscribeOnlineStatus')
  handleUnsubscribeOnlineStatus(@ConnectedSocket() client: Socket, @MessageBody() data: { userId: string }) {
    client.leave(`online_status_${data.userId}`);
    return { success: true };
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(@MessageBody() data: { senderId: string; recipientId: string; content: string; senderName?: string }) {
    console.log(`Message from ${data.senderId} to ${data.recipientId}: ${data.content}`);

    try {
      const message = await this.messagesService.createMessage(data.senderId, data.recipientId, data.content, undefined, data.senderName);
      const messageData = {
        id: message.id,
        senderId: message.senderId,
        recipientId: message.recipientId,
        content: message.content,
        createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
        isRead: message.isRead,
        conversationId: message.conversationId,
      };

      this.server.to(`user_${data.recipientId}`).emit('newMessage', messageData);
      this.server.to(`user_${data.senderId}`).emit('messageSent', messageData);

      console.log(`Message saved and delivered`);
      return { success: true, message: messageData };
    } catch (error) {
      console.error('Error sending message:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(@MessageBody() data: { conversationId: string; userId: string }) {
    try {
      await this.messagesService.markAsRead(data.conversationId, data.userId);
      const [u1, u2] = data.conversationId.split('_');
      const otherUserId = u1 === data.userId ? u2 : u1;
      this.server.to(`user_${otherUserId}`).emit('messagesRead', {
        conversationId: data.conversationId,
        readBy: data.userId,
      });
      return { success: true };
    } catch (error) {
      console.error('Error marking as read:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('typing')
  handleTyping(@MessageBody() data: { senderId: string; recipientId: string; isTyping: boolean }) {
    this.server.to(`user_${data.recipientId}`).emit('userTyping', {
      userId: data.senderId,
      isTyping: data.isTyping,
    });
    return { success: true };
  }

  // ========== MESSAGE DELETION (Real-time) ==========

  @SubscribeMessage('unsendMessage')
  async handleUnsendMessage(@MessageBody() data: { messageId: string; userId: string }) {
    try {
      const result = await this.messagesService.deleteForEveryone(data.messageId, data.userId);
      if (result.success) {
        // Notify both sender and recipient in real-time
        // Find the message to get recipientId
        const message = await this.messagesService.getMessageById(data.messageId);
        if (message) {
          const otherUserId = message.senderId === data.userId ? message.recipientId : message.senderId;
          // Emit to the other user
          this.server.to(`user_${otherUserId}`).emit('messageUnsent', {
            messageId: data.messageId,
            unsendBy: data.userId,
          });
          // Confirm to sender
          this.server.to(`user_${data.userId}`).emit('messageUnsent', {
            messageId: data.messageId,
            unsendBy: data.userId,
          });
        }
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ========== MESSAGE EDITING (Real-time) ==========

  @SubscribeMessage('editMessage')
  async handleEditMessage(@MessageBody() data: { messageId: string; userId: string; content: string }) {
    try {
      const result = await this.messagesService.editMessage(data.messageId, data.userId, data.content);
      if (result.success && result.editedMessage) {
        const otherUserId = result.editedMessage.senderId === data.userId 
          ? result.editedMessage.recipientId 
          : result.editedMessage.senderId;
        // Notify recipient
        this.server.to(`user_${otherUserId}`).emit('messageEdited', result.editedMessage);
        // Confirm to sender
        this.server.to(`user_${data.userId}`).emit('messageEdited', result.editedMessage);
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ========== THEME COLOR CHANGE (Real-time) ==========

  @SubscribeMessage('changeThemeColor')
  async handleChangeThemeColor(@MessageBody() data: {
    senderId: string;
    recipientId: string;
    themeColor: string;
    senderName?: string;
  }) {
    try {
      // Update BOTH participants' theme color (shared like Messenger)
      await this.messagesService.updateSharedThemeColor(
        data.senderId,
        data.recipientId,
        data.themeColor,
      );

      // Create a system message for the theme change
      const message = await this.messagesService.createSystemMessage(
        data.senderId,
        data.recipientId,
        `[THEME_CHANGE:${data.themeColor}]`,
      );

      const messageData = {
        id: message.id,
        senderId: message.senderId,
        recipientId: message.recipientId,
        content: message.content,
        createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
        isRead: message.isRead,
        conversationId: message.conversationId,
      };

      // Emit system message to BOTH users via normal message channels
      this.server.to(`user_${data.recipientId}`).emit('newMessage', messageData);
      this.server.to(`user_${data.senderId}`).emit('messageSent', messageData);

      // Emit theme color changed event to recipient so their chat updates in real-time
      this.server.to(`user_${data.recipientId}`).emit('themeColorChanged', {
        conversationId: message.conversationId,
        themeColor: data.themeColor,
        changedBy: data.senderId,
      });

      console.log(`Theme color changed to ${data.themeColor} by user ${data.senderId} in conversation with ${data.recipientId}`);
      return { success: true, message: messageData };
    } catch (error) {
      console.error('Error changing theme color:', error);
      return { success: false, error: error.message };
    }
  }

  // ========== PUBLIC METHOD FOR HTTP CONTROLLER ==========

  /**
   * Emit newMessage/messageSent events from HTTP controller
   * Called when messages are created via REST API instead of WebSocket
   */
  emitNewMessage(recipientId: string, senderId: string, messageData: any) {
    this.server.to(`user_${recipientId}`).emit('newMessage', messageData);
    this.server.to(`user_${senderId}`).emit('messageSent', messageData);
  }

  /**
   * Emit messageEdited events from HTTP controller
   * Called when messages are edited via REST API instead of WebSocket
   */
  emitMessageEdited(recipientId: string, senderId: string, editedMessage: any) {
    this.server.to(`user_${recipientId}`).emit('messageEdited', editedMessage);
    this.server.to(`user_${senderId}`).emit('messageEdited', editedMessage);
  }

  /**
   * Emit privacy settings changed event to all connected clients
   * Used when a user updates messaging/online status privacy settings
   */
  emitPrivacySettingsChanged(userId: string, settings: { whoCanSendMessages?: string; showOnlineStatus?: boolean }) {
    // Broadcast to all connected clients so active chat screens can re-check permissions
    this.server.emit('privacySettingsChanged', {
      userId,
      ...settings,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit newNotification event to recipient via WebSocket.
   * Provides instant badge update without relying on FCM push delivery timing.
   */
  emitNewNotification(recipientId: string, data: any) {
    this.server.to(`user_${recipientId}`).emit('newNotification', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit online status visibility changed - when user toggles showOnlineStatus off,
   * broadcast them as offline to all subscribers and track in hidden set
   */
  emitOnlineStatusVisibilityChanged(userId: string, showOnlineStatus: boolean) {
    if (!showOnlineStatus) {
      // Add to hidden set so all future queries return offline
      this.hiddenStatusUsers.add(userId);
      // Appear offline to everyone
      this.broadcastOnlineStatus(userId, false);
    } else {
      // Remove from hidden set
      this.hiddenStatusUsers.delete(userId);
      // If they're actually online, broadcast as online
      const isOnline = this.onlineUsers.has(userId) && 
                       this.userSockets.has(userId) && 
                       (this.userSockets.get(userId)?.size || 0) > 0;
      if (isOnline) {
        this.broadcastOnlineStatus(userId, true);
      }
    }
  }
}

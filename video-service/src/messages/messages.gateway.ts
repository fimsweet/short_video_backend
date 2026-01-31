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

  constructor(private messagesService: MessagesService) {}

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
          this.onlineUsers.delete(userId);
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
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { userId: string }) {
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
    
    // Broadcast online status if user just came online
    if (wasOffline) {
      this.broadcastOnlineStatus(data.userId, true);
      console.log(`User ${data.userId} is now online`);
    }
    
    return { success: true };
  }

  // Broadcast user online/offline status to all connected clients
  private broadcastOnlineStatus(userId: string, isOnline: boolean) {
    this.server.emit('userOnlineStatus', {
      userId,
      isOnline,
      timestamp: new Date().toISOString(),
    });
  }

  // Get online status of a specific user
  @SubscribeMessage('getOnlineStatus')
  handleGetOnlineStatus(@MessageBody() data: { userId: string }) {
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
    
    // Send current status immediately
    const isOnline = this.onlineUsers.has(data.userId) && 
                     this.userSockets.has(data.userId) && 
                     (this.userSockets.get(data.userId)?.size || 0) > 0;
    
    client.emit('userOnlineStatus', {
      userId: data.userId,
      isOnline,
      timestamp: new Date().toISOString(),
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
  async handleMessage(@MessageBody() data: { senderId: string; recipientId: string; content: string }) {
    console.log(`Message from ${data.senderId} to ${data.recipientId}: ${data.content}`);

    try {
      const message = await this.messagesService.createMessage(data.senderId, data.recipientId, data.content);
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
}

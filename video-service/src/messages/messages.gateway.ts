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
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(private messagesService: MessagesService) {}

  afterInit() {
    console.log('🔌 WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    console.log(`🔌 Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.userSockets.forEach((sockets, userId) => {
      if (sockets.delete(client.id) && sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    });
    console.log(`🔌 Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join')
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { userId: string }) {
    if (!data.userId) {
      return { success: false, error: 'userId required' };
    }

    if (!this.userSockets.has(data.userId)) {
      this.userSockets.set(data.userId, new Set());
    }

    const userSocketSet = this.userSockets.get(data.userId);
    if (userSocketSet) {
      userSocketSet.add(client.id);
    }

    client.join(`user_${data.userId}`);
    console.log(`👤 User ${data.userId} joined with socket ${client.id}`);
    return { success: true };
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(@MessageBody() data: { senderId: string; recipientId: string; content: string }) {
    console.log(`💬 Message from ${data.senderId} to ${data.recipientId}: ${data.content}`);

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

      console.log(`✅ Message saved and delivered`);
      return { success: true, message: messageData };
    } catch (error) {
      console.error('❌ Error sending message:', error);
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
      console.error('❌ Error marking as read:', error);
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

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '../entities/message.entity';
import { Conversation } from '../entities/conversation.entity';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
  ) {}

  private getConversationId(userId1: string, userId2: string): string {
    const sorted = [userId1, userId2].sort();
    return `${sorted[0]}_${sorted[1]}`;
  }

  async createMessage(senderId: string, recipientId: string, content: string): Promise<Message> {
    const conversationId = this.getConversationId(senderId, recipientId);

    // Create or update conversation
    let conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      const sorted = [senderId, recipientId].sort();
      conversation = this.conversationRepository.create({
        id: conversationId,
        participant1Id: sorted[0],
        participant2Id: sorted[1],
        lastMessage: content,
        lastMessageSenderId: senderId,
      });
    } else {
      conversation.lastMessage = content;
      conversation.lastMessageSenderId = senderId;
    }
    await this.conversationRepository.save(conversation);

    // Create message
    const message = this.messageRepository.create({
      senderId,
      recipientId,
      content,
      conversationId,
      isRead: false,
    });

    return this.messageRepository.save(message);
  }

  async getMessages(userId1: string, userId2: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    const conversationId = this.getConversationId(userId1, userId2);
    const messages = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    
    // Ensure createdAt is returned as ISO string with 'Z' suffix for UTC
    return messages.map(message => ({
      ...message,
      createdAt: message.createdAt instanceof Date 
        ? message.createdAt.toISOString() 
        : message.createdAt,
    }));
  }

  async getConversations(userId: string): Promise<any[]> {
    const conversations = await this.conversationRepository
      .createQueryBuilder('c')
      .where('c.participant1Id = :userId OR c.participant2Id = :userId', { userId })
      .orderBy('c.updatedAt', 'DESC')
      .getMany();

    return Promise.all(
      conversations.map(async (conv) => {
        const otherUserId = conv.participant1Id === userId ? conv.participant2Id : conv.participant1Id;
        const unreadCount = await this.messageRepository.count({
          where: { conversationId: conv.id, recipientId: userId, isRead: false },
        });
        return { 
          id: conv.id, 
          otherUserId, 
          lastMessage: conv.lastMessage, 
          lastMessageSenderId: conv.lastMessageSenderId, 
          updatedAt: conv.updatedAt ? new Date(conv.updatedAt).toISOString() : null, 
          unreadCount 
        };
      }),
    );
  }

  async markAsRead(conversationId: string, userId: string): Promise<void> {
    await this.messageRepository.update(
      { conversationId, recipientId: userId, isRead: false },
      { isRead: true },
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.messageRepository.count({ where: { recipientId: userId, isRead: false } });
  }

  async getConversationSettings(userId: string, recipientId: string): Promise<{ isMuted: boolean; isPinned: boolean }> {
    const conversationId = this.getConversationId(userId, recipientId);
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      return { isMuted: false, isPinned: false };
    }

    // Check if user is participant1 or participant2 to get correct settings
    const isParticipant1 = conversation.participant1Id === userId;
    
    return {
      isMuted: isParticipant1 ? (conversation.isMutedBy1 ?? false) : (conversation.isMutedBy2 ?? false),
      isPinned: isParticipant1 ? (conversation.isPinnedBy1 ?? false) : (conversation.isPinnedBy2 ?? false),
    };
  }

  async updateConversationSettings(
    userId: string,
    recipientId: string,
    settings: { isMuted?: boolean; isPinned?: boolean },
  ): Promise<void> {
    const conversationId = this.getConversationId(userId, recipientId);
    let conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      // Create conversation if not exists
      const sorted = [userId, recipientId].sort();
      conversation = this.conversationRepository.create({
        id: conversationId,
        participant1Id: sorted[0],
        participant2Id: sorted[1],
      });
    }

    const isParticipant1 = conversation.participant1Id === userId;

    if (settings.isMuted !== undefined) {
      if (isParticipant1) {
        conversation.isMutedBy1 = settings.isMuted;
      } else {
        conversation.isMutedBy2 = settings.isMuted;
      }
    }

    if (settings.isPinned !== undefined) {
      if (isParticipant1) {
        conversation.isPinnedBy1 = settings.isPinned;
      } else {
        conversation.isPinnedBy2 = settings.isPinned;
      }
    }

    await this.conversationRepository.save(conversation);
  }
}

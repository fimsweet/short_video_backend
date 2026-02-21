import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In, Not, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Message } from '../entities/message.entity';
import { Conversation } from '../entities/conversation.entity';
import { PushNotificationService } from '../notifications/push-notification.service';
import { PrivacyService } from '../config/privacy.service';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
    private pushNotificationService: PushNotificationService,
    private privacyService: PrivacyService,
    private configService: ConfigService,
  ) {}

  private getConversationId(userId1: string, userId2: string): string {
    const sorted = [userId1, userId2].sort();
    return `${sorted[0]}_${sorted[1]}`;
  }

  async createMessage(
    senderId: string, 
    recipientId: string, 
    content: string,
    replyTo?: { id: string; content: string; senderId: string },
    senderName?: string,
  ): Promise<Message> {
    // Check if sender is allowed to message recipient
    const canMessage = await this.privacyService.canSendMessage(senderId, recipientId);
    if (!canMessage.allowed) {
      const reason = (canMessage as any).isDeactivated
        ? 'Tài khoản này đã bị vô hiệu hóa, không thể gửi tin nhắn'
        : (canMessage.reason || 'Bạn không được phép gửi tin nhắn cho người này');
      throw new ForbiddenException(reason);
    }

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
      // Reply to support
      replyToId: replyTo?.id,
      replyToContent: replyTo?.content,
      replyToSenderId: replyTo?.senderId,
    });

    const savedMessage = await this.messageRepository.save(message);

    // Send push notification for new message
    // Check if recipient has set a nickname for the sender
    let displayName = senderName || `User ${senderId}`;
    if (conversation) {
      const isRecipientParticipant1 = conversation.participant1Id === recipientId;
      const nickname = isRecipientParticipant1 ? conversation.nicknameBy1 : conversation.nicknameBy2;
      if (nickname) {
        displayName = nickname;
      }
    }
    // Check if recipient has muted this conversation before sending notification
    const isRecipientP1 = conversation.participant1Id === recipientId;
    const isMuted = isRecipientP1 ? conversation.isMutedBy1 : conversation.isMutedBy2;
    
    if (!isMuted) {
      this.pushNotificationService.sendMessageNotification(
        recipientId,
        displayName,
        content,
        conversationId,
        senderId,
      ).catch(err => {
        console.error('[PUSH] Error sending message notification:', err?.message || err);
      });
    }

    return savedMessage;
  }

  async getMessages(userId1: string, userId2: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    const conversationId = this.getConversationId(userId1, userId2);
    const messages = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    
    // Filter and transform messages based on deletion status
    return messages
      .filter(message => {
        // Skip messages deleted for this user
        const deletedForUserIds = message.deletedForUserIds || [];
        if (deletedForUserIds.includes(userId1)) {
          return false;
        }
        return true;
      })
      .map(message => {
        // If deleted for everyone, show placeholder
        if (message.isDeletedForEveryone) {
          return {
            ...message,
            content: '[MESSAGE_DELETED]',
            imageUrls: [],
            isDeletedForEveryone: true,
            createdAt: message.createdAt instanceof Date 
              ? message.createdAt.toISOString() 
              : message.createdAt,
          };
        }
        
        return {
          ...message,
          createdAt: message.createdAt instanceof Date 
            ? message.createdAt.toISOString() 
            : message.createdAt,
        };
      });
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

        // Fetch the actual latest visible message for this user
        // Skip messages deleted for this user (deletedForUserIds contains userId)
        const recentMessages = await this.messageRepository
          .createQueryBuilder('m')
          .where('m.conversationId = :conversationId', { conversationId: conv.id })
          .orderBy('m.createdAt', 'DESC')
          .take(20) // fetch a batch to find first visible one
          .getMany();

        let lastMessage = conv.lastMessage;
        let lastMessageSenderId = conv.lastMessageSenderId;
        let isLastMessageUnsent = false;

        // Find the first message not deleted for this user
        const latestVisibleMessage = recentMessages.find(msg => {
          const deletedFor = msg.deletedForUserIds || [];
          return !deletedFor.includes(userId);
        });

        if (latestVisibleMessage) {
          if (latestVisibleMessage.isDeletedForEveryone) {
            isLastMessageUnsent = true;
            lastMessage = '';
            lastMessageSenderId = latestVisibleMessage.senderId;
          } else {
            lastMessage = latestVisibleMessage.content;
            lastMessageSenderId = latestVisibleMessage.senderId;
          }
        }

        return { 
          id: conv.id, 
          otherUserId, 
          lastMessage,
          lastMessageSenderId,
          isLastMessageUnsent,
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

  async getConversationSettings(userId: string, recipientId: string): Promise<{ isMuted: boolean; isPinned: boolean; themeColor: string | null; nickname: string | null; autoTranslate: boolean }> {
    const conversationId = this.getConversationId(userId, recipientId);
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      return { isMuted: false, isPinned: false, themeColor: null, nickname: null, autoTranslate: false };
    }

    // Check if user is participant1 or participant2 to get correct settings
    const isParticipant1 = conversation.participant1Id === userId;
    
    return {
      isMuted: isParticipant1 ? (conversation.isMutedBy1 ?? false) : (conversation.isMutedBy2 ?? false),
      isPinned: isParticipant1 ? (conversation.isPinnedBy1 ?? false) : (conversation.isPinnedBy2 ?? false),
      themeColor: isParticipant1 ? (conversation.themeColorBy1 ?? null) : (conversation.themeColorBy2 ?? null),
      nickname: isParticipant1 ? (conversation.nicknameBy1 ?? null) : (conversation.nicknameBy2 ?? null),
      autoTranslate: isParticipant1 ? (conversation.autoTranslateBy1 ?? false) : (conversation.autoTranslateBy2 ?? false),
    };
  }

  async updateConversationSettings(
    userId: string,
    recipientId: string,
    settings: { isMuted?: boolean; isPinned?: boolean; themeColor?: string; nickname?: string; autoTranslate?: boolean },
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

    if (settings.themeColor !== undefined) {
      if (isParticipant1) {
        conversation.themeColorBy1 = settings.themeColor;
      } else {
        conversation.themeColorBy2 = settings.themeColor;
      }
    }

    if (settings.nickname !== undefined) {
      // Treat empty string as clearing the nickname
      const nicknameValue = settings.nickname === '' ? null : settings.nickname;
      if (isParticipant1) {
        conversation.nicknameBy1 = nicknameValue;
      } else {
        conversation.nicknameBy2 = nicknameValue;
      }
    }

    if (settings.autoTranslate !== undefined) {
      if (isParticipant1) {
        conversation.autoTranslateBy1 = settings.autoTranslate;
      } else {
        conversation.autoTranslateBy2 = settings.autoTranslate;
      }
    }

    await this.conversationRepository.save(conversation);
  }

  /**
   * Update theme color for BOTH participants in a conversation (shared theme like Messenger).
   * Returns true if the theme was actually changed.
   */
  async updateSharedThemeColor(
    userId: string,
    recipientId: string,
    themeColor: string,
  ): Promise<boolean> {
    const conversationId = this.getConversationId(userId, recipientId);
    let conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      const sorted = [userId, recipientId].sort();
      conversation = this.conversationRepository.create({
        id: conversationId,
        participant1Id: sorted[0],
        participant2Id: sorted[1],
      });
    }

    // Set BOTH participants to the same theme color
    conversation.themeColorBy1 = themeColor;
    conversation.themeColorBy2 = themeColor;
    await this.conversationRepository.save(conversation);
    return true;
  }

  /**
   * Create a system message (no push notification, no lastMessage update).
   * Used for theme changes, nickname changes, etc.
   */
  async createSystemMessage(
    senderId: string,
    recipientId: string,
    content: string,
  ): Promise<Message> {
    const conversationId = this.getConversationId(senderId, recipientId);

    // Ensure conversation exists
    let conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      const sorted = [senderId, recipientId].sort();
      conversation = this.conversationRepository.create({
        id: conversationId,
        participant1Id: sorted[0],
        participant2Id: sorted[1],
      });
      await this.conversationRepository.save(conversation);
    }

    // Create message without updating lastMessage or sending push
    const message = this.messageRepository.create({
      senderId,
      recipientId,
      content,
      conversationId,
      isRead: false,
    });

    return this.messageRepository.save(message);
  }

  // ========== PINNED MESSAGES ==========

  async pinMessage(messageId: string, userId: string): Promise<Message> {
    const message = await this.messageRepository.findOne({ where: { id: messageId } });
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Verify user is part of the conversation
    if (message.senderId !== userId && message.recipientId !== userId) {
      throw new ForbiddenException('You cannot pin this message');
    }

    message.pinnedBy = userId;
    message.pinnedAt = new Date();
    return this.messageRepository.save(message);
  }

  async unpinMessage(messageId: string, userId: string): Promise<Message> {
    const message = await this.messageRepository.findOne({ where: { id: messageId } });
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Only the user who pinned can unpin
    if (message.pinnedBy !== userId) {
      throw new ForbiddenException('You cannot unpin this message');
    }

    // Use update() to reliably set NULL in DB (save() with null can be unreliable)
    await this.messageRepository.update(messageId, {
      pinnedBy: null as any,
      pinnedAt: null as any,
    });

    // Return updated entity
    const updated = await this.messageRepository.findOne({ where: { id: messageId } });
    if (!updated) {
      throw new NotFoundException('Message not found after update');
    }
    return updated;
  }

  async getPinnedMessages(userId: string, recipientId: string): Promise<Message[]> {
    const conversationId = this.getConversationId(userId, recipientId);
    return this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .andWhere('message.pinnedBy = :userId', { userId })
      .andWhere('message.isDeletedForEveryone = false')
      .andWhere(
        '(message.deletedForUserIds IS NULL OR message.deletedForUserIds NOT LIKE :userPattern)',
        { userPattern: `%${userId}%` },
      )
      .orderBy('message.pinnedAt', 'DESC')
      .getMany();
  }

  // ========== SEARCH MESSAGES ==========

  async searchMessages(userId: string, recipientId: string, query: string, limit: number = 50): Promise<Message[]> {
    const conversationId = this.getConversationId(userId, recipientId);
    
    return this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .andWhere('LOWER(message.content) LIKE LOWER(:query)', { query: `%${query}%` })
      .andWhere("message.content NOT LIKE '[IMAGE:%'")
      .andWhere("message.content NOT LIKE '[VIDEO_SHARE:%'")
      .andWhere("message.content NOT LIKE '[STACKED_IMAGE:%'")
      .orderBy('message.createdAt', 'DESC')
      .take(limit)
      .getMany();
  }

  // ========== MEDIA MESSAGES ==========

  async getMediaMessages(userId: string, recipientId: string, limit: number = 50, offset: number = 0): Promise<Message[]> {
    const conversationId = this.getConversationId(userId, recipientId);
    
    console.log('========== getMediaMessages DEBUG ==========');
    console.log(`userId (currentUser): ${userId}`);
    console.log(`recipientId: ${recipientId}`);
    console.log(`conversationId: ${conversationId}`);
    console.log(`limit: ${limit}, offset: ${offset}`);
    
    // First, let's check ALL media messages in DB for debugging
    const allMediaMessages = await this.messageRepository
      .createQueryBuilder('message')
      .where(
        '(message.imageUrls IS NOT NULL AND message.imageUrls != \'\') OR message.content LIKE :imagePattern OR message.content LIKE :stackedPattern',
        { 
          imagePattern: '[IMAGE:%',
          stackedPattern: '[STACKED_IMAGE:%'
        }
      )
      .select(['message.id', 'message.conversationId', 'message.senderId', 'message.recipientId'])
      .take(10)
      .getMany();
    
    console.log(`DEBUG: All media messages in DB (first 10):`);
    allMediaMessages.forEach((m, i) => {
      console.log(`  [${i}] conversationId: ${m.conversationId}, sender: ${m.senderId}, recipient: ${m.recipientId}`);
    });
    
    // Search for messages with imageUrls OR content containing image markers
    // Use both conversationId AND sender/recipient check for backward compatibility
    // IMPORTANT: Wrap media conditions in parentheses to avoid operator precedence issues
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where(
        // Match by conversationId OR by sender/recipient pair
        '(message.conversationId = :conversationId OR ' +
        '((message.senderId = :userId AND message.recipientId = :recipientId) OR ' +
        '(message.senderId = :recipientId AND message.recipientId = :userId)))',
        { conversationId, userId, recipientId }
      )
      .andWhere(
        // MUST wrap this entire condition in parentheses!
        '((message.imageUrls IS NOT NULL AND message.imageUrls != \'\') OR message.content LIKE :imagePattern OR message.content LIKE :stackedPattern)',
        { 
          imagePattern: '[IMAGE:%',
          stackedPattern: '[STACKED_IMAGE:%'
        }
      )
      .orderBy('message.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getMany();
    
    console.log(`Found ${messages.length} media messages for conversation ${conversationId}`);
    if (messages.length > 0) {
      console.log(`First message - senderId: ${messages[0].senderId}, recipientId: ${messages[0].recipientId}`);
      console.log(`First message - conversationId: ${messages[0].conversationId}`);
      console.log(`First message - content: ${messages[0].content?.substring(0, 50)}...`);
    }
    console.log('============================================');
    
    return messages;
  }

  // ========== MESSAGE DELETION ==========

  // Time limit for unsending messages (10 minutes in milliseconds)
  private readonly UNSEND_TIME_LIMIT_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Get a single message by ID
   */
  async getMessageById(messageId: string): Promise<Message | null> {
    return this.messageRepository.findOne({ where: { id: messageId } });
  }

  /**
   * Delete message for the current user only
   * The message will still be visible to other participants
   */
  async deleteForMe(messageId: string, userId: string): Promise<{ success: boolean; message?: string }> {
    const message = await this.messageRepository.findOne({ where: { id: messageId } });
    
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Verify user is part of the conversation
    if (message.senderId !== userId && message.recipientId !== userId) {
      throw new ForbiddenException('You cannot delete this message');
    }

    // Add userId to deletedForUserIds array
    const deletedForUserIds = message.deletedForUserIds || [];
    if (!deletedForUserIds.includes(userId)) {
      deletedForUserIds.push(userId);
    }

    message.deletedForUserIds = deletedForUserIds;
    await this.messageRepository.save(message);

    return { success: true };
  }

  /**
   * Delete message for everyone (unsend)
   * Only the sender can unsend and only within the time limit
   */
  async deleteForEveryone(messageId: string, userId: string): Promise<{ success: boolean; message?: string; canUnsend?: boolean }> {
    const message = await this.messageRepository.findOne({ where: { id: messageId } });
    
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Only the sender can unsend
    if (message.senderId !== userId) {
      throw new ForbiddenException('Only the sender can unsend messages');
    }

    // Check if already deleted
    if (message.isDeletedForEveryone) {
      return { success: false, message: 'Message already deleted' };
    }

    // Check time limit
    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    if (messageAge > this.UNSEND_TIME_LIMIT_MS) {
      return { 
        success: false, 
        canUnsend: false,
        message: 'Cannot unsend message after 10 minutes' 
      };
    }

    // Mark as deleted for everyone
    message.isDeletedForEveryone = true;
    message.deletedForEveryoneAt = new Date();
    message.deletedForEveryoneBy = userId;
    message.content = ''; // Clear content
    message.imageUrls = []; // Clear images

    // Also unpin the message if it was pinned
    if (message.pinnedBy) {
      message.pinnedBy = null as any;
      message.pinnedAt = null as any;
    }
    
    await this.messageRepository.save(message);

    // Update conversation lastMessage if this was the latest message
    const conversationId = this.getConversationId(message.senderId, message.recipientId);
    const conversation = await this.conversationRepository.findOne({ where: { id: conversationId } });
    if (conversation) {
      // Find the latest non-deleted message for the conversation preview
      const latestMessage = await this.messageRepository
        .createQueryBuilder('m')
        .where('m.conversationId = :conversationId', { conversationId })
        .andWhere('m.isDeletedForEveryone = false')
        .orderBy('m.createdAt', 'DESC')
        .getOne();
      
      if (latestMessage) {
        conversation.lastMessage = latestMessage.content;
        conversation.lastMessageSenderId = latestMessage.senderId;
      } else {
        // All messages deleted
        conversation.lastMessage = '';
        conversation.lastMessageSenderId = '';
      }
      await this.conversationRepository.save(conversation);
    }

    return { success: true };
  }

  /**
   * Check if a message can still be unsent (within time limit)
   */
  canUnsendMessage(message: Message, userId: string): boolean {
    if (message.senderId !== userId) return false;
    if (message.isDeletedForEveryone) return false;
    
    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    return messageAge <= this.UNSEND_TIME_LIMIT_MS;
  }

  /**
   * Get remaining time (in seconds) before unsend expires
   */
  getUnsendTimeRemaining(message: Message): number {
    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    const remaining = this.UNSEND_TIME_LIMIT_MS - messageAge;
    return Math.max(0, Math.floor(remaining / 1000));
  }

  // ========== MESSAGE EDITING ==========

  // Time limit for editing messages (15 minutes)
  private readonly EDIT_TIME_LIMIT_MS = 15 * 60 * 1000;

  /**
   * Edit a message — only sender, within time limit, text messages only
   */
  async editMessage(messageId: string, userId: string, newContent: string): Promise<{ success: boolean; message?: string; editedMessage?: any }> {
    const message = await this.messageRepository.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('Only the sender can edit messages');
    if (message.isDeletedForEveryone) return { success: false, message: 'Cannot edit a deleted message' };

    // Check time limit
    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    if (messageAge > this.EDIT_TIME_LIMIT_MS) {
      return { success: false, message: 'Cannot edit message after 15 minutes' };
    }

    // Don't allow editing image/video/sticker messages
    if (message.content.startsWith('[IMAGE:') || message.content.startsWith('[VIDEO_SHARE:') || 
        message.content.startsWith('[STACKED_IMAGE:') || message.content.startsWith('[STICKER:') ||
        message.content.startsWith('[VOICE:')) {
      return { success: false, message: 'Cannot edit non-text messages' };
    }

    // Save original content on first edit
    if (!message.isEdited) {
      message.originalContent = message.content;
    }

    message.content = newContent.trim();
    message.isEdited = true;
    message.editedAt = new Date();
    await this.messageRepository.save(message);

    return {
      success: true,
      editedMessage: {
        id: message.id,
        content: message.content,
        isEdited: true,
        editedAt: message.editedAt instanceof Date ? message.editedAt.toISOString() : message.editedAt,
        senderId: message.senderId,
        recipientId: message.recipientId,
        conversationId: message.conversationId,
      },
    };
  }

  /**
   * Check if a message can still be edited
   */
  canEditMessage(message: Message, userId: string): boolean {
    if (message.senderId !== userId) return false;
    if (message.isDeletedForEveryone) return false;
    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    return messageAge <= this.EDIT_TIME_LIMIT_MS;
  }

  /**
   * Translate message using Gemini AI
   */
  async translateMessage(text: string, targetLanguage: string): Promise<{ success: boolean; translatedText?: string; error?: string }> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    
    if (!apiKey) {
      return { success: false, error: 'Gemini API key not configured' };
    }

    try {
      const targetLang = targetLanguage === 'vi' ? 'Vietnamese' : 'English';
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `You are a translator. Translate the following text to ${targetLang}.

Rules:
1. If the text is already in ${targetLang}, return it exactly as is.
2. If the text is gibberish, random characters, meaningless strings, slang abbreviations without clear meaning (e.g. "dzzz", "asdf", "haha", "lol", "hmm"), or cannot be meaningfully translated, return the original text exactly as is.
3. Only translate text that has clear semantic meaning in a recognizable language.
4. Only return the translated text, nothing else. No explanations.

Text to translate:
${text}`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
            },
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Gemini API error:', errorData);
        return { success: false, error: 'Translation service error' };
      }

      const data = await response.json();
      const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!translatedText) {
        return { success: false, error: 'No translation returned' };
      }

      return { success: true, translatedText };
    } catch (error) {
      console.error('Translation error:', error);
      return { success: false, error: 'Translation failed' };
    }
  }
}

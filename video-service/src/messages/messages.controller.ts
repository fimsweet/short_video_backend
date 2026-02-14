import { Controller, Get, Post, Put, Body, Param, Query, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';

// Ensure upload directory exists at startup
const chatImagesPath = join(process.cwd(), 'uploads', 'chat_images');
console.log('Chat images path:', chatImagesPath);

if (!existsSync(chatImagesPath)) {
  mkdirSync(chatImagesPath, { recursive: true });
  console.log('Created chat_images directory:', chatImagesPath);
} else {
  console.log('Chat images directory exists:', chatImagesPath);
}

@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly messagesGateway: MessagesGateway,
  ) {}

  @Post('send')
  async sendMessage(
    @Body() body: { 
      senderId: string; 
      recipientId: string; 
      content: string;
      senderName?: string;
      replyTo?: { id: string; content: string; senderId: string };
    },
  ) {
    const message = await this.messagesService.createMessage(
      body.senderId,
      body.recipientId,
      body.content,
      body.replyTo,
      body.senderName,
    );

    // Emit WebSocket events so both parties get real-time updates
    const messageData = {
      id: message.id,
      senderId: message.senderId,
      recipientId: message.recipientId,
      content: message.content,
      createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
      isRead: message.isRead,
      conversationId: message.conversationId,
      replyToId: (message as any).replyToId || null,
      replyToContent: (message as any).replyToContent || null,
      replyToSenderId: (message as any).replyToSenderId || null,
    };

    this.messagesGateway.emitNewMessage(body.recipientId, body.senderId, messageData);

    return { success: true, data: message };
  }

  @Get('conversation/:userId1/:userId2')
  async getMessages(
    @Param('userId1') userId1: string,
    @Param('userId2') userId2: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
  ) {
    const messages = await this.messagesService.getMessages(
      userId1,
      userId2,
      parseInt(limit, 10),
      parseInt(offset, 10),
    );
    return { success: true, data: messages };
  }

  @Get('conversations/:userId')
  async getConversations(@Param('userId') userId: string) {
    const conversations = await this.messagesService.getConversations(userId);
    return { success: true, data: conversations };
  }

  @Post('read')
  async markAsRead(@Body() body: { conversationId: string; userId: string }) {
    await this.messagesService.markAsRead(body.conversationId, body.userId);
    return { success: true };
  }

  @Get('unread/:userId')
  async getUnreadCount(@Param('userId') userId: string) {
    const count = await this.messagesService.getUnreadCount(userId);
    return { success: true, count };
  }

  @Get('settings/:recipientId')
  async getConversationSettings(
    @Param('recipientId') recipientId: string,
    @Query('userId') userId: string,
  ) {
    const settings = await this.messagesService.getConversationSettings(userId, recipientId);
    return settings;
  }

  @Put('settings/:recipientId')
  async updateConversationSettings(
    @Param('recipientId') recipientId: string,
    @Query('userId') userId: string,
    @Body() body: { isMuted?: boolean; isPinned?: boolean; themeColor?: string; nickname?: string },
  ) {
    await this.messagesService.updateConversationSettings(userId, recipientId, body);
    return { success: true };
  }

  // ========== PINNED MESSAGES ==========

  @Post('pin/:messageId')
  async pinMessage(
    @Param('messageId') messageId: string,
    @Query('userId') userId: string,
  ) {
    const message = await this.messagesService.pinMessage(messageId, userId);
    return { success: true, data: message };
  }

  @Post('unpin/:messageId')
  async unpinMessage(
    @Param('messageId') messageId: string,
    @Query('userId') userId: string,
  ) {
    const message = await this.messagesService.unpinMessage(messageId, userId);
    return { success: true, data: message };
  }

  @Get('pinned/:userId1/:userId2')
  async getPinnedMessages(
    @Param('userId1') userId1: string,
    @Param('userId2') userId2: string,
  ) {
    const messages = await this.messagesService.getPinnedMessages(userId1, userId2);
    return { success: true, data: messages };
  }

  // ========== SEARCH MESSAGES ==========

  @Get('search/:userId1/:userId2')
  async searchMessages(
    @Param('userId1') userId1: string,
    @Param('userId2') userId2: string,
    @Query('query') query: string,
    @Query('limit') limit: string = '50',
  ) {
    const messages = await this.messagesService.searchMessages(userId1, userId2, query, parseInt(limit, 10));
    return { success: true, data: messages };
  }

  // ========== MEDIA MESSAGES ==========

  @Get('media/:userId1/:userId2')
  async getMediaMessages(
    @Param('userId1') userId1: string,
    @Param('userId2') userId2: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
  ) {
    const messages = await this.messagesService.getMediaMessages(userId1, userId2, parseInt(limit, 10), parseInt(offset, 10));
    return { success: true, data: messages };
  }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image', {
    storage: diskStorage({
      destination: (req, file, cb) => {
        console.log('Setting destination for file:', file.originalname);
        // Ensure directory exists
        if (!existsSync(chatImagesPath)) {
          mkdirSync(chatImagesPath, { recursive: true });
          console.log('Created directory:', chatImagesPath);
        }
        cb(null, chatImagesPath);
      },
      filename: (req, file, cb) => {
        // Generate unique filename using timestamp and random string
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 15);
        const ext = extname(file.originalname) || '.jpg';
        const uniqueName = `chat_${timestamp}_${randomStr}${ext}`;
        console.log('Generated filename:', uniqueName);
        cb(null, uniqueName);
      },
    }),
    fileFilter: (req, file, cb) => {
      console.log('Checking file:', file.originalname, 'mimetype:', file.mimetype);
      // Accept common image types
      const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        console.log('Rejected file type:', file.mimetype);
        cb(new BadRequestException(`Invalid file type: ${file.mimetype}. Only images are allowed.`), false);
      }
    },
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
  }))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    console.log('Upload image endpoint called');
    
    if (!file) {
      console.log('No file received');
      return { success: false, message: 'No file uploaded' };
    }

    console.log('File received:', {
      originalname: file.originalname,
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
      path: file.path,
    });

    const imageUrl = `/uploads/chat_images/${file.filename}`;
    console.log('Chat image uploaded successfully:', imageUrl);

    return {
      success: true,
      imageUrl,
      filename: file.filename,
    };
  }

  // ========== MESSAGE DELETION ==========

  @Post(':messageId/delete-for-me')
  async deleteForMe(
    @Param('messageId') messageId: string,
    @Query('userId') userId: string,
  ) {
    const result = await this.messagesService.deleteForMe(messageId, userId);
    return result;
  }

  @Post(':messageId/delete-for-everyone')
  async deleteForEveryone(
    @Param('messageId') messageId: string,
    @Query('userId') userId: string,
  ) {
    const result = await this.messagesService.deleteForEveryone(messageId, userId);
    return result;
  }

  @Post(':messageId/edit')
  async editMessage(
    @Param('messageId') messageId: string,
    @Query('userId') userId: string,
    @Body() body: { content: string },
  ) {
    const result = await this.messagesService.editMessage(messageId, userId, body.content);

    // Emit WebSocket events so both parties see the edit in real-time
    if (result.success && result.editedMessage) {
      const otherUserId = result.editedMessage.senderId === userId
        ? result.editedMessage.recipientId
        : result.editedMessage.senderId;
      this.messagesGateway.emitMessageEdited(otherUserId, userId, result.editedMessage);
    }

    return result;
  }

  @Post('translate')
  async translateMessage(
    @Body() body: { text: string; targetLanguage: string },
  ) {
    const result = await this.messagesService.translateMessage(body.text, body.targetLanguage);
    return result;
  }
}

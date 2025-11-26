import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { MessagesService } from './messages.service';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('send')
  async sendMessage(
    @Body() body: { senderId: string; recipientId: string; content: string },
  ) {
    const message = await this.messagesService.createMessage(
      body.senderId,
      body.recipientId,
      body.content,
    );
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
}

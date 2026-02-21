import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Headers,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  /**
   * Get all active sessions for current user
   */
  @Get()
  async getSessions(
    @Request() req,
    @Headers('authorization') authHeader: string,
  ) {
    const token = authHeader?.replace('Bearer ', '');
    const sessions = await this.sessionsService.getUserSessions(req.user.id, token);
    
    return {
      success: true,
      data: sessions,
    };
  }

  /**
   * Update FCM token for push notifications
   */
  @Post('fcm-token')
  async updateFcmToken(
    @Request() req,
    @Headers('authorization') authHeader: string,
    @Body() body: { fcmToken: string },
  ) {
    const token = authHeader?.replace('Bearer ', '');
    const result = await this.sessionsService.updateFcmToken(
      req.user.id,
      token,
      body.fcmToken,
    );
    
    return {
      success: result.success,
      message: result.success ? 'FCM token updated' : 'Failed to update FCM token',
    };
  }

  /**
   * Clear FCM token on logout (prevents stale push notifications)
   */
  @Post('clear-fcm-token')
  async clearFcmToken(
    @Request() req,
    @Headers('authorization') authHeader: string,
  ) {
    const token = authHeader?.replace('Bearer ', '');
    const result = await this.sessionsService.clearFcmToken(req.user.id, token);
    return {
      success: result.success,
      message: 'FCM token cleared',
    };
  }

  /**
   * Get login alerts status
   */
  @Get('login-alerts')
  async getLoginAlertsStatus(
    @Request() req,
    @Headers('authorization') authHeader: string,
  ) {
    const token = authHeader?.replace('Bearer ', '');
    const status = await this.sessionsService.getLoginAlertsStatus(req.user.id, token);
    
    return {
      success: true,
      ...status,
    };
  }

  /**
   * Toggle login alerts for current session
   */
  @Post('login-alerts')
  async toggleLoginAlerts(
    @Request() req,
    @Headers('authorization') authHeader: string,
    @Body() body: { enabled: boolean },
  ) {
    const token = authHeader?.replace('Bearer ', '');
    const result = await this.sessionsService.toggleLoginAlerts(
      req.user.id,
      token,
      body.enabled,
    );
    
    return {
      success: result.success,
      enabled: body.enabled,
      message: body.enabled 
        ? 'Đã bật cảnh báo đăng nhập' 
        : 'Đã tắt cảnh báo đăng nhập',
    };
  }

  /**
   * Logout from a specific session
   */
  @Delete(':sessionId')
  async logoutSession(
    @Request() req,
    @Param('sessionId', ParseIntPipe) sessionId: number,
  ) {
    const result = await this.sessionsService.logoutSession(req.user.id, sessionId);
    return result;
  }

  /**
   * Logout from all other sessions (except current)
   */
  @Post('logout-others')
  async logoutOtherSessions(
    @Request() req,
    @Headers('authorization') authHeader: string,
  ) {
    const token = authHeader?.replace('Bearer ', '');
    const result = await this.sessionsService.logoutAllOtherSessions(req.user.id, token);
    
    return {
      success: true,
      message: `Đã đăng xuất ${result.count} thiết bị khác`,
      count: result.count,
    };
  }

  /**
   * Logout from all sessions (including current)
   */
  @Post('logout-all')
  async logoutAllSessions(@Request() req) {
    const result = await this.sessionsService.logoutAllSessions(req.user.id);
    
    return {
      success: true,
      message: `Đã đăng xuất tất cả ${result.count} thiết bị`,
      count: result.count,
    };
  }
}

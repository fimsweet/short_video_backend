import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  /**
   * Check if Firebase Admin is ready (initialized by FirebaseAdminService or self)
   * Uses lazy check so it works regardless of module loading order
   */
  private ensureInitialized(): boolean {
    if (admin.apps.length > 0) {
      return true;
    }

    // Last resort: try to initialize ourselves if FirebaseAdminService hasn't done it yet
    this.logger.warn('Firebase not yet initialized by AuthModule, attempting self-init...');
    try {
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH 
        || path.join(process.cwd(), 'firebase-service-account.json');
      
      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        this.logger.log(`Firebase Admin self-initialized (project: ${serviceAccount.project_id})`);
        return true;
      }
    } catch (error) {
      this.logger.error('Firebase self-init failed:', error);
    }

    return false;
  }

  /**
   * Send push notification to a single device
   */
  async sendToDevice(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<boolean> {
    if (!this.ensureInitialized()) {
      this.logger.warn('Firebase not initialized, skipping notification');
      return false;
    }

    try {
      const message: admin.messaging.Message = {
        token: fcmToken,
        notification: {
          title,
          body,
        },
        data: data || {},
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      this.logger.log(`Notification sent successfully: ${response}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Failed to send notification: ${error.message}`);
      
      // If token is invalid, return false so caller can remove it
      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        return false;
      }
      
      return false;
    }
  }

  /**
   * Send push notification to multiple devices
   */
  async sendToDevices(
    fcmTokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ successCount: number; failureCount: number; failedTokens: string[]; errors: Array<{ token: string; code: string; message: string }> }> {
    if (!this.ensureInitialized()) {
      this.logger.warn('Firebase not initialized, skipping notifications');
      return { successCount: 0, failureCount: fcmTokens.length, failedTokens: fcmTokens, errors: [{ token: '', code: 'NOT_INITIALIZED', message: 'Firebase Admin SDK not initialized' }] };
    }

    if (fcmTokens.length === 0) {
      return { successCount: 0, failureCount: 0, failedTokens: [], errors: [] };
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        tokens: fcmTokens,
        notification: {
          title,
          body,
        },
        data: data || {},
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      
      const failedTokens: string[] = [];
      const errors: Array<{ token: string; code: string; message: string }> = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(fcmTokens[idx]);
          const errorCode = resp.error?.code || 'UNKNOWN';
          const errorMessage = resp.error?.message || 'Unknown error';
          errors.push({ token: fcmTokens[idx].substring(0, 30) + '...', code: errorCode, message: errorMessage });
          this.logger.error(
            `FCM send failed for token[${idx}]: code=${errorCode}, message=${errorMessage}`,
          );
          this.logger.error(
            `FCM failed token[${idx}] FULL: ${fcmTokens[idx]}`,
          );
        } else {
          this.logger.log(`FCM send SUCCESS for token[${idx}]: messageId=${resp.messageId}`);
        }
      });

      this.logger.log(`Notifications sent: ${response.successCount} success, ${response.failureCount} failed`);
      
      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        failedTokens,
        errors,
      };
    } catch (error: any) {
      this.logger.error(`Failed to send notifications: ${error.message}`);
      return { successCount: 0, failureCount: fcmTokens.length, failedTokens: fcmTokens, errors: [{ token: '', code: 'EXCEPTION', message: error.message }] };
    }
  }

  /**
   * Send login alert notification
   */
  async sendLoginAlert(
    fcmTokens: string[],
    deviceName: string,
    platform: string,
    location: string,
    ipAddress: string,
  ): Promise<{ successCount: number; failedTokens: string[] }> {
    const title = '🔐 Cảnh báo đăng nhập mới';
    const body = `Phát hiện đăng nhập mới từ ${deviceName || platform}${location ? ` tại ${location}` : ''}`;
    
    const data = {
      type: 'login_alert',
      deviceName: deviceName || '',
      platform: platform || '',
      location: location || '',
      ipAddress: ipAddress || '',
      timestamp: new Date().toISOString(),
    };

    const result = await this.sendToDevices(fcmTokens, title, body, data);
    return {
      successCount: result.successCount,
      failedTokens: result.failedTokens,
    };
  }
}

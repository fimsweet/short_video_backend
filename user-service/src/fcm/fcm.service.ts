import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private isInitialized = false;

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      // Check if Firebase is already initialized
      if (admin.apps.length > 0) {
        this.isInitialized = true;
        this.logger.log('Firebase Admin already initialized');
        return;
      }

      // Try to initialize with service account file
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
      
      try {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        this.isInitialized = true;
        this.logger.log('Firebase Admin initialized with service account');
      } catch (error) {
        // If service account file doesn't exist, try default credentials
        this.logger.warn('Firebase service account not found, FCM notifications disabled');
        this.isInitialized = false;
      }
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin:', error);
      this.isInitialized = false;
    }
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
    if (!this.isInitialized) {
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
  ): Promise<{ successCount: number; failureCount: number; failedTokens: string[] }> {
    if (!this.isInitialized) {
      this.logger.warn('Firebase not initialized, skipping notifications');
      return { successCount: 0, failureCount: fcmTokens.length, failedTokens: fcmTokens };
    }

    if (fcmTokens.length === 0) {
      return { successCount: 0, failureCount: 0, failedTokens: [] };
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
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(fcmTokens[idx]);
        }
      });

      this.logger.log(`Notifications sent: ${response.successCount} success, ${response.failureCount} failed`);
      
      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        failedTokens,
      };
    } catch (error: any) {
      this.logger.error(`Failed to send notifications: ${error.message}`);
      return { successCount: 0, failureCount: fcmTokens.length, failedTokens: fcmTokens };
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

import * as nodemailer from 'nodemailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private isConfigured: boolean = false;

  constructor(private configService: ConfigService) {
    const emailUser = this.configService.get<string>('EMAIL_USER');
    const emailPass = this.configService.get<string>('EMAIL_APP_PASSWORD');

    if (emailUser && emailPass) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: emailUser,
          pass: emailPass, // Use App Password, not regular password
        },
      });
      this.isConfigured = true;
      console.log('Email service configured successfully');
    } else {
      console.log('Email service not configured - EMAIL_USER or EMAIL_APP_PASSWORD missing');
    }
  }

  async sendOtpEmail(to: string, otp: string): Promise<boolean> {
    if (!this.isConfigured) {
      console.log(`[MOCK] Would send OTP ${otp} to ${to}`);
      return true; // Return true for development/testing
    }

    const emailUser = this.configService.get<string>('EMAIL_USER') || '';
    const mailOptions = {
      from: `"Short Video App" <${emailUser}>`,
      to: to,
      subject: 'Mã xác nhận đặt lại mật khẩu - Password Reset Code',
      html: this.getOtpEmailTemplate(otp),
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`OTP email sent to ${to}`);
      return true;
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      return false;
    }
  }

  private getOtpEmailTemplate(otp: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Code</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f5f5; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #FE2C55 0%, #FF0050 100%); padding: 32px 24px; text-align: center; border-radius: 16px 16px 0 0;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">
                    🔐 Password Reset
                  </h1>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 32px 24px;">
                  <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                    Xin chào! / Hello!
                  </p>
                  <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                    Bạn đã yêu cầu đặt lại mật khẩu. Đây là mã xác nhận của bạn:<br/>
                    You requested a password reset. Here is your verification code:
                  </p>
                  
                  <!-- OTP Code Box -->
                  <div style="background: linear-gradient(135deg, #f8f8f8 0%, #f0f0f0 100%); border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; border: 2px dashed #FE2C55;">
                    <span style="font-size: 36px; font-weight: bold; color: #FE2C55; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                      ${otp}
                    </span>
                  </div>
                  
                  <p style="color: #999999; font-size: 13px; line-height: 1.6; margin: 0 0 16px 0; text-align: center;">
                    ⏱️ Mã này sẽ hết hạn sau <strong>10 phút</strong><br/>
                    This code will expire in <strong>10 minutes</strong>
                  </p>
                  
                  <div style="background-color: #fff3cd; border-radius: 8px; padding: 16px; margin: 24px 0;">
                    <p style="color: #856404; font-size: 13px; margin: 0;">
                      ⚠️ <strong>Cảnh báo / Warning:</strong><br/>
                      Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.<br/>
                      If you didn't request a password reset, please ignore this email.
                    </p>
                  </div>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f8f8; padding: 24px; text-align: center; border-radius: 0 0 16px 16px;">
                  <p style="color: #999999; font-size: 12px; margin: 0;">
                    © 2026 Short Video App. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;
  }

  async send2FAOtpEmail(to: string, otp: string): Promise<boolean> {
    if (!this.isConfigured) {
      console.log(`[MOCK] Would send 2FA OTP ${otp} to ${to}`);
      return true;
    }

    const emailUser = this.configService.get<string>('EMAIL_USER') || '';
    const mailOptions = {
      from: `"Short Video App" <${emailUser}>`,
      to: to,
      subject: 'Mã xác thực tài khoản - Verification Code',
      html: this.get2FAOtpEmailTemplate(otp),
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`2FA OTP email sent to ${to}`);
      return true;
    } catch (error) {
      console.error('Failed to send 2FA OTP email:', error);
      return false;
    }
  }

  private get2FAOtpEmailTemplate(otp: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verification Code</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f5f5; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); padding: 32px 24px; text-align: center; border-radius: 16px 16px 0 0;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">
                    🔑 Mã xác thực / Verification Code
                  </h1>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 32px 24px;">
                  <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                    Xin chào! / Hello!
                  </p>
                  <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                    Bạn đang thực hiện xác thực hai yếu tố (2FA). Đây là mã xác thực của bạn:<br/>
                    You are performing two-factor authentication (2FA). Here is your verification code:
                  </p>
                  
                  <!-- OTP Code Box -->
                  <div style="background: linear-gradient(135deg, #f8f8f8 0%, #f0f0f0 100%); border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; border: 2px dashed #25D366;">
                    <span style="font-size: 36px; font-weight: bold; color: #128C7E; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                      ${otp}
                    </span>
                  </div>
                  
                  <p style="color: #999999; font-size: 13px; line-height: 1.6; margin: 0 0 16px 0; text-align: center;">
                    ⏱️ Mã này sẽ hết hạn sau <strong>10 phút</strong><br/>
                    This code will expire in <strong>10 minutes</strong>
                  </p>
                  
                  <div style="background-color: #d4edda; border-radius: 8px; padding: 16px; margin: 24px 0;">
                    <p style="color: #155724; font-size: 13px; margin: 0;">
                      🔒 <strong>Bảo mật / Security:</strong><br/>
                      Nếu bạn không thực hiện yêu cầu này, vui lòng đổi mật khẩu ngay lập tức.<br/>
                      If you did not make this request, please change your password immediately.
                    </p>
                  </div>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f8f8; padding: 24px; text-align: center; border-radius: 0 0 16px 16px;">
                  <p style="color: #999999; font-size: 12px; margin: 0;">
                    © 2026 Short Video App. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;
  }

  async sendWelcomeEmail(to: string, username: string): Promise<boolean> {
    if (!this.isConfigured) {
      console.log(`[MOCK] Would send welcome email to ${to}`);
      return true;
    }

    const emailUser = this.configService.get<string>('EMAIL_USER') || '';
    const mailOptions = {
      from: `"Short Video App" <${emailUser}>`,
      to: to,
      subject: 'Chào mừng đến với Short Video App! 🎉',
      html: this.getWelcomeEmailTemplate(username),
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Welcome email sent to ${to}`);
      return true;
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      return false;
    }
  }

  private getWelcomeEmailTemplate(username: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Welcome!</title>
    </head>
    <body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <tr>
          <td style="background: linear-gradient(135deg, #FE2C55 0%, #FF0050 100%); padding: 32px 24px; text-align: center; border-radius: 16px 16px 0 0;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px;">🎉 Welcome!</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 32px 24px; text-align: center;">
            <h2 style="color: #333333; margin: 0 0 16px 0;">Xin chào, ${username}!</h2>
            <p style="color: #666666; font-size: 16px; line-height: 1.6;">
              Chào mừng bạn đến với Short Video App! 
              Hãy bắt đầu khám phá và chia sẻ những video thú vị của bạn.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color: #f8f8f8; padding: 24px; text-align: center; border-radius: 0 0 16px 16px;">
            <p style="color: #999999; font-size: 12px; margin: 0;">
              © 2026 Short Video App. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;
  }
}

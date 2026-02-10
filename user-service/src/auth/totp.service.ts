import { Injectable, BadRequestException } from '@nestjs/common';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateURI, generate, verify } from 'otplib';
import * as QRCode from 'qrcode';

@Injectable()
export class TotpService {
  private readonly APP_NAME = 'ShortVideo';
  private readonly crypto = new NobleCryptoPlugin();
  private readonly base32 = new ScureBase32Plugin();
  private readonly totp: TOTP;

  constructor() {
    // Initialize TOTP with crypto and base32 plugins
    this.totp = new TOTP({
      crypto: this.crypto,
      base32: this.base32,
      digits: 6,
      period: 30, // 30-second time window
    });
  }

  /**
   * Generate a new TOTP secret for a user
   */
  createSecret(): string {
    return generateSecret({ crypto: this.crypto, base32: this.base32 });
  }

  /**
   * Generate the otpauth:// URI for QR code scanning
   */
  generateKeyUri(username: string, secret: string): string {
    return generateURI({
      secret,
      issuer: this.APP_NAME,
      label: username,
    });
  }

  /**
   * Generate a QR code as base64 data URL
   */
  async generateQRCode(otpauthUrl: string): Promise<string> {
    try {
      return await QRCode.toDataURL(otpauthUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });
    } catch (error) {
      throw new BadRequestException('Không thể tạo mã QR');
    }
  }

  /**
   * Verify a TOTP token against a secret
   */
  async verifyToken(token: string, secret: string): Promise<boolean> {
    try {
      const result = await verify({
        token,
        secret,
        crypto: this.crypto,
        base32: this.base32,
        digits: 6,
        period: 30,
        epochTolerance: 30,
      });
      return result.valid;
    } catch {
      return false;
    }
  }

  /**
   * Generate a current valid token (for testing only)
   */
  async generateToken(secret: string): Promise<string> {
    return await this.totp.generate({ secret });
  }
}

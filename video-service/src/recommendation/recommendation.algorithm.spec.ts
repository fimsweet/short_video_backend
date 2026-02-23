/**
 * ============================================
 * Recommendation Algorithm – Unit Tests
 * ============================================
 * Covers:
 *   UT-VID-03  : Scoring weight integrity
 *   UT-AUTH-02 : bcrypt password hashing
 *   UT-VID-01 / UT-VID-02 : MIME-type filter
 * ============================================
 */
import * as bcrypt from 'bcrypt';
import {
  WEIGHTS,
  DISCOVERY_RATIO,
} from './recommendation.service';
import {
  ALLOWED_VIDEO_MIMETYPES,
  multerConfig,
} from '../config/multer.config';

// ─── UT-VID-03: Scoring weight integrity ────────────────────────
describe('UT-VID-03: scoring weight integrity', () => {
  it('WEIGHTS coefficients sum to exactly 1.0', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('DISCOVERY_RATIO equals 0.20', () => {
    expect(DISCOVERY_RATIO).toBe(0.20);
  });

  it('WEIGHTS should contain all required scoring factors', () => {
    expect(WEIGHTS).toHaveProperty('INTEREST_MATCH');
    expect(WEIGHTS).toHaveProperty('ENGAGEMENT');
    expect(WEIGHTS).toHaveProperty('RECENCY');
    expect(WEIGHTS).toHaveProperty('EXPLORATION');
    expect(WEIGHTS).toHaveProperty('FRESHNESS');
  });

  it('All weight values should be positive', () => {
    Object.values(WEIGHTS).forEach((w) => {
      expect(w).toBeGreaterThan(0);
    });
  });
});

// ─── UT-AUTH-02: bcrypt password hashing ────────────────────────
describe('UT-AUTH-02: bcrypt password hashing', () => {
  const SALT_ROUNDS = 10;
  const plainPassword = 'P@ssw0rd_Secure!';

  it('should produce a 60-character bcrypt hash', async () => {
    const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    expect(hash).toHaveLength(60);
    expect(hash).toMatch(/^\$2[aby]?\$/);
  });

  it('should verify correct password against hash', async () => {
    const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    const isMatch = await bcrypt.compare(plainPassword, hash);
    expect(isMatch).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    const isMatch = await bcrypt.compare('WrongPassword!', hash);
    expect(isMatch).toBe(false);
  });
});

// ─── UT-VID-01 / UT-VID-02: MIME type filter ───────────────────
describe('UT-VID-01 / UT-VID-02: MIME type filter', () => {
  const fileFilter = (multerConfig as any).fileFilter;

  it('should ACCEPT video/mp4', (done) => {
    const mockFile = { mimetype: 'video/mp4', originalname: 'clip.mp4', fieldname: 'video' };
    fileFilter({}, mockFile, (err: Error | null, accepted: boolean) => {
      expect(err).toBeNull();
      expect(accepted).toBe(true);
      done();
    });
  });

  it('should REJECT application/pdf', (done) => {
    const mockFile = { mimetype: 'application/pdf', originalname: 'doc.pdf', fieldname: 'video' };
    fileFilter({}, mockFile, (err: Error | null, accepted: boolean) => {
      expect(err).toBeTruthy();
      expect(err!.message).toContain('Only video or image files are allowed');
      expect(accepted).toBe(false);
      done();
    });
  });

  it('should REJECT text/plain', (done) => {
    const mockFile = { mimetype: 'text/plain', originalname: 'readme.txt', fieldname: 'video' };
    fileFilter({}, mockFile, (err: Error | null, accepted: boolean) => {
      expect(err).toBeTruthy();
      expect(err!.message).toContain('Only video or image files are allowed');
      expect(accepted).toBe(false);
      done();
    });
  });

  it('should ACCEPT all allowed video formats', () => {
    expect(ALLOWED_VIDEO_MIMETYPES).toContain('video/mp4');
    expect(ALLOWED_VIDEO_MIMETYPES).toContain('video/quicktime');
    expect(ALLOWED_VIDEO_MIMETYPES).toContain('video/webm');
    expect(ALLOWED_VIDEO_MIMETYPES).toContain('video/x-msvideo');
    expect(ALLOWED_VIDEO_MIMETYPES).toContain('video/x-matroska');
    expect(ALLOWED_VIDEO_MIMETYPES.length).toBeGreaterThanOrEqual(5);
  });
});

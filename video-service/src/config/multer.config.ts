import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// 🔒 ALLOWED VIDEO FORMATS
// ============================================
// These are real video MIME types that FFmpeg can process
// Used for both initial filter AND magic number validation
// ============================================
export const ALLOWED_VIDEO_MIMETYPES = [
  'video/mp4',
  'video/quicktime',    // .mov
  'video/x-msvideo',    // .avi
  'video/x-matroska',   // .mkv
  'video/webm',
  'video/3gpp',         // .3gp
  'video/x-m4v',        // .m4v
  'video/mpeg',
];

export const ALLOWED_IMAGE_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export const multerConfig = {
  storage: diskStorage({
    destination: './uploads/raw_videos',
    filename: (req, file, callback) => {
      const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
      callback(null, uniqueName);
    },
  }),
  fileFilter: (req, file, callback) => {
    // Log để debug
    console.log('File upload attempt:');
    console.log('  Original name:', file.originalname);
    console.log('  MIME type:', file.mimetype);
    console.log('  Field name:', file.fieldname);
    
    // ============================================
    // 🔒 SECURITY: Multi-layer validation
    // ============================================
    // Layer 1: Check MIME type from request header (this filter)
    // Layer 2: Check magic number after file saved (in videos.service.ts)
    // This prevents attackers from uploading .exe disguised as .mp4
    // ============================================
    
    const isAllowedVideo = ALLOWED_VIDEO_MIMETYPES.includes(file.mimetype);
    const isAllowedImage = ALLOWED_IMAGE_MIMETYPES.includes(file.mimetype);
    
    if (isAllowedVideo || isAllowedImage) {
      console.log('[OK] File accepted (MIME check passed, magic number check pending)');
      callback(null, true);
    } else {
      console.log('[ERROR] File rejected - not an allowed video/image type');
      console.log(`   Allowed video types: ${ALLOWED_VIDEO_MIMETYPES.join(', ')}`);
      callback(new Error(`Only video or image files are allowed! Received: ${file.mimetype}`), false);
    }
  },
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
  },
};

// Separate config for thumbnail uploads only
export const thumbnailMulterConfig = {
  storage: diskStorage({
    destination: './uploads/thumbnails',
    filename: (req, file, callback) => {
      const uniqueName = `thumb_${uuidv4()}${extname(file.originalname)}`;
      callback(null, uniqueName);
    },
  }),
  fileFilter: (req, file, callback) => {
    console.log('Thumbnail upload attempt:');
    console.log('  Original name:', file.originalname);
    console.log('  MIME type:', file.mimetype);
    
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      console.log('Thumbnail accepted');
      callback(null, true);
    } else {
      console.log('Thumbnail rejected - not an image');
      callback(new Error(`Only image files are allowed for thumbnails! Received: ${file.mimetype}`), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max for thumbnails
  },
};

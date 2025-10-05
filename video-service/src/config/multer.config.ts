import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';

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
    console.log('📹 File upload attempt:');
    console.log('  Original name:', file.originalname);
    console.log('  MIME type:', file.mimetype);
    console.log('  Field name:', file.fieldname);
    
    // Accept any video MIME type (more lenient)
    if (file.mimetype.startsWith('video/')) {
      console.log('✅ File accepted');
      callback(null, true);
    } else {
      console.log('❌ File rejected - not a video');
      callback(new Error(`Only video files are allowed! Received: ${file.mimetype}`), false);
    }
  },
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
  },
};

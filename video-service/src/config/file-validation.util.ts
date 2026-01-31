import * as fs from 'fs';
import * as path from 'path';

// ============================================
// 🔒 MAGIC NUMBER VALIDATION
// ============================================
// This utility validates files by reading their actual binary content
// (magic numbers / file signatures) instead of trusting file extensions
// or MIME types from HTTP headers.
//
// WHY THIS MATTERS:
// - Attackers can rename malware.exe to video.mp4
// - HTTP MIME type is set by the client, can be faked
// - Only magic numbers in the file header cannot be faked
// ============================================

// Video file signatures (magic numbers)
// Reference: https://en.wikipedia.org/wiki/List_of_file_signatures
const VIDEO_SIGNATURES: { mime: string; signature: number[]; offset?: number }[] = [
  // MP4 (ftyp box) - Most common
  { mime: 'video/mp4', signature: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // "ftyp" at offset 4
  
  // QuickTime MOV (also uses ftyp)
  { mime: 'video/quicktime', signature: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  
  // WebM (EBML header)
  { mime: 'video/webm', signature: [0x1A, 0x45, 0xDF, 0xA3] },
  
  // MKV (EBML header, same as WebM)
  { mime: 'video/x-matroska', signature: [0x1A, 0x45, 0xDF, 0xA3] },
  
  // AVI (RIFF header)
  { mime: 'video/x-msvideo', signature: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
  
  // MPEG
  { mime: 'video/mpeg', signature: [0x00, 0x00, 0x01, 0xBA] }, // MPEG PS
  { mime: 'video/mpeg', signature: [0x00, 0x00, 0x01, 0xB3] }, // MPEG VS
  
  // 3GP (also uses ftyp)
  { mime: 'video/3gpp', signature: [0x66, 0x74, 0x79, 0x70], offset: 4 },
];

// Image file signatures
const IMAGE_SIGNATURES: { mime: string; signature: number[]; offset?: number }[] = [
  // JPEG
  { mime: 'image/jpeg', signature: [0xFF, 0xD8, 0xFF] },
  
  // PNG
  { mime: 'image/png', signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  
  // GIF
  { mime: 'image/gif', signature: [0x47, 0x49, 0x46, 0x38] }, // "GIF8"
  
  // WebP (RIFF + WEBP)
  { mime: 'image/webp', signature: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" (need to also check for WEBP)
];

/**
 * Read first N bytes of a file
 */
function readFileHeader(filePath: string, bytes: number = 32): Buffer {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(bytes);
  fs.readSync(fd, buffer, 0, bytes, 0);
  fs.closeSync(fd);
  return buffer;
}

/**
 * Check if buffer matches signature at given offset
 */
function matchesSignature(buffer: Buffer, signature: number[], offset: number = 0): boolean {
  if (buffer.length < offset + signature.length) {
    return false;
  }
  
  for (let i = 0; i < signature.length; i++) {
    if (buffer[offset + i] !== signature[i]) {
      return false;
    }
  }
  
  return true;
}

/**
 * Validate if file is a real video by checking magic numbers
 * @param filePath Path to the uploaded file
 * @returns Object with isValid boolean and detected MIME type
 */
export async function validateVideoFile(filePath: string): Promise<{
  isValid: boolean;
  detectedMime: string | null;
  error?: string;
}> {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return { isValid: false, detectedMime: null, error: 'File not found' };
    }

    // Read file header (first 32 bytes is enough for most signatures)
    const header = readFileHeader(filePath, 32);
    
    // Check against known video signatures
    for (const sig of VIDEO_SIGNATURES) {
      if (matchesSignature(header, sig.signature, sig.offset || 0)) {
        console.log(`[OK] [Magic Number] Valid video detected: ${sig.mime}`);
        return { isValid: true, detectedMime: sig.mime };
      }
    }

    // No valid video signature found
    console.log(`[ERROR] [Magic Number] Invalid video file - no matching signature`);
    console.log(`   First 16 bytes: ${header.slice(0, 16).toString('hex')}`);
    
    return {
      isValid: false,
      detectedMime: null,
      error: 'File does not have a valid video signature. Possible fake file.',
    };
  } catch (error) {
    console.error(`[ERROR] [Magic Number] Validation error:`, error.message);
    return { isValid: false, detectedMime: null, error: error.message };
  }
}

/**
 * Validate if file is a real image by checking magic numbers
 */
export async function validateImageFile(filePath: string): Promise<{
  isValid: boolean;
  detectedMime: string | null;
  error?: string;
}> {
  try {
    if (!fs.existsSync(filePath)) {
      return { isValid: false, detectedMime: null, error: 'File not found' };
    }

    const header = readFileHeader(filePath, 32);
    
    for (const sig of IMAGE_SIGNATURES) {
      if (matchesSignature(header, sig.signature, sig.offset || 0)) {
        // Special check for WebP (RIFF...WEBP)
        if (sig.mime === 'image/webp') {
          const webpMarker = Buffer.from('WEBP');
          if (!header.slice(8, 12).equals(webpMarker)) {
            continue; // Not a WebP, might be AVI
          }
        }
        
        console.log(`[OK] [Magic Number] Valid image detected: ${sig.mime}`);
        return { isValid: true, detectedMime: sig.mime };
      }
    }

    return {
      isValid: false,
      detectedMime: null,
      error: 'File does not have a valid image signature.',
    };
  } catch (error) {
    return { isValid: false, detectedMime: null, error: error.message };
  }
}

/**
 * Delete file if validation fails (cleanup)
 */
export function deleteInvalidFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[DELETE] [Security] Deleted invalid file: ${filePath}`);
    }
  } catch (error) {
    console.error(`[WARN] Could not delete invalid file: ${error.message}`);
  }
}

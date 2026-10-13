export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB

export const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif'];
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];

export interface ClientValidationResult {
  valid: boolean;
  reasonCode?: string;
  errorMessage?: string;
}

export function validateFileClientSide(file: File): ClientValidationResult {
  const nameLower = file.name.toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => nameLower.endsWith(ext));

  // Browsers often report empty mime type for HEIC/HEIF files, so accept if extension matches
  const isHeicExt = nameLower.endsWith('.heic') || nameLower.endsWith('.heif');
  const hasValidMime =
    ALLOWED_MIME_TYPES.includes(file.type) || (isHeicExt && (!file.type || file.type === ''));

  if (!hasValidExt || !hasValidMime) {
    return {
      valid: false,
      reasonCode: 'INVALID_FORMAT',
      errorMessage: 'Unsupported file format. Only JPEG, PNG, and HEIC files are allowed.',
    };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      valid: false,
      reasonCode: 'FILE_TOO_LARGE',
      errorMessage: 'File exceeds maximum upload limit of 15MB.',
    };
  }

  return { valid: true };
}

export const REASON_MESSAGES: Record<string, string> = {
  INVALID_FORMAT: 'Unsupported format. Upload a standard JPEG, PNG, or HEIC photo.',
  FILE_TOO_SMALL: 'File size is too small or heavily compressed. Minimum 50KB required.',
  FILE_TOO_LARGE: 'File exceeds the 15MB upload limit.',
  RESOLUTION_TOO_LOW: 'Resolution is too low. Upload a photo with at least 640x640 pixels.',
  IMAGE_BLURRY: 'Photo is blurry or out of focus. Please upload a sharp, crisp selfie.',
  NO_FACE_DETECTED: 'No face detected. Ensure your face is clearly visible and looking at the camera.',
  MULTIPLE_FACES: 'More than one face detected. Upload a photo with only one person.',
  FACE_TOO_SMALL: 'Face is too far away. The face should take up at least 5% of the frame.',
  DUPLICATE_OR_SIMILAR: 'Similar or duplicate photo already accepted in your batch.',
};

export function getReasonMessage(code: string): string {
  return REASON_MESSAGES[code] || `Quality issue detected (${code}).`;
}

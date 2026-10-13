export type ImageStatus =
  | 'CLIENT_REJECTED'
  | 'UPLOADING'
  | 'PROCESSING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'FAILED';

export type ReasonCode =
  | 'INVALID_FORMAT'
  | 'FILE_TOO_SMALL'
  | 'RESOLUTION_TOO_LOW'
  | 'IMAGE_BLURRY'
  | 'NO_FACE_DETECTED'
  | 'MULTIPLE_FACES'
  | 'FACE_TOO_SMALL'
  | 'DUPLICATE_OR_SIMILAR'
  | 'FILE_TOO_LARGE';

export interface ServerImageDto {
  id: string;
  ownerId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  storageKey: string;
  processedKey: string | null;
  thumbnailKey: string | null;
  status: 'PROCESSING' | 'ACCEPTED' | 'REJECTED' | 'FAILED';
  rejectionReasons: string[];
  blurScore: number | null;
  faceCount: number | null;
  faceAreaRatio: number | null;
  attempts: number;
  createdAt: string;
  processedAt: string | null;
  thumbnailUrl: string | null;
  processedUrl: string | null;
}

export interface UploadItem {
  clientId: string;
  file?: File;
  previewUrl: string;
  serverId?: string;
  status: ImageStatus;
  progress: number;
  reasons: string[];
  error?: string;
  originalName: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  blurScore?: number | null;
  faceCount?: number | null;
  faceAreaRatio?: number | null;
  createdAt?: string;
  thumbnailUrl?: string | null;
  processedUrl?: string | null;
}

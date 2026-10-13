import type { Metadata } from 'sharp';
import type { ImageRecord } from '../repositories/image.repository.js';
import type { Thresholds } from '../config/thresholds.js';

export type ReasonCode =
  | 'INVALID_FORMAT'
  | 'FILE_TOO_SMALL'
  | 'RESOLUTION_TOO_LOW'
  | 'IMAGE_BLURRY'
  | 'NO_FACE_DETECTED'
  | 'MULTIPLE_FACES'
  | 'FACE_TOO_SMALL'
  | 'DUPLICATE_OR_SIMILAR';

export type ValidationResult = { ok: true } | { ok: false; reason: ReasonCode };

export interface ValidationMetrics {
  blurScore?: number;
  faceCount?: number;
  faceAreaRatio?: number;
  phash?: string;
  width?: number;
  height?: number;
}

export interface ValidationContext {
  row: ImageRecord;
  buffer: Buffer;
  metadata: Metadata;
  metrics: ValidationMetrics;
  thresholds: Thresholds;
}

export interface Validator {
  name: string;
  validate(ctx: ValidationContext): Promise<ValidationResult>;
}

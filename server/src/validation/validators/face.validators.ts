import type { Validator, ValidationContext, ValidationResult } from '../types.js';
import type { FaceDetector, FaceDetection } from '../../infra/face/faceDetector.interface.js';

// Cache detections per context to avoid duplicate inference runs between count and size checks
const detectionCache = new WeakMap<ValidationContext, FaceDetection[]>();

export class FaceCountValidator implements Validator {
  name = 'FaceCountValidator';

  constructor(private detector: FaceDetector) {}

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    let detections = detectionCache.get(ctx);
    if (!detections) {
      detections = await this.detector.detectFaces(ctx.buffer);
      detectionCache.set(ctx, detections);
    }

    const count = detections.length;
    ctx.metrics.faceCount = count;

    if (count === 0) {
      return { ok: false, reason: 'NO_FACE_DETECTED' };
    }

    if (count > 1) {
      return { ok: false, reason: 'MULTIPLE_FACES' };
    }

    return { ok: true };
  }
}

export class FaceSizeValidator implements Validator {
  name = 'FaceSizeValidator';

  constructor(private detector: FaceDetector) {}

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    let detections = detectionCache.get(ctx);
    if (!detections) {
      detections = await this.detector.detectFaces(ctx.buffer);
      detectionCache.set(ctx, detections);
    }

    const count = detections.length;
    ctx.metrics.faceCount = count;

    if (count === 0) {
      // Handled by FaceCountValidator
      return { ok: true };
    }

    const imageWidth = ctx.metadata.width || 1;
    const imageHeight = ctx.metadata.height || 1;

    // Find the largest face bounding box area
    let maxFaceArea = 0;
    for (const d of detections) {
      const area = d.box.width * d.box.height;
      if (area > maxFaceArea) {
        maxFaceArea = area;
      }
    }

    // Since face-api might have run on a scaled image (max 1024px), normalize the area ratio
    // If detections returned are relative to the scaled image, calculate ratio against scaled dimensions, or scale box back.
    // In our detector, box dimensions are returned in coordinates of the input buffer given to detectFaces (which is inside 1024x1024).
    const scaledWidth = Math.min(imageWidth, 1024);
    const scaleFactor = scaledWidth / imageWidth;
    const scaledHeight = imageHeight * scaleFactor;
    const effectiveArea = scaledWidth * scaledHeight;

    const ratio = effectiveArea > 0 ? maxFaceArea / effectiveArea : 0;
    ctx.metrics.faceAreaRatio = Math.round(ratio * 1000) / 1000;

    if (ratio < ctx.thresholds.minFaceAreaRatio) {
      return { ok: false, reason: 'FACE_TOO_SMALL' };
    }

    return { ok: true };
  }
}

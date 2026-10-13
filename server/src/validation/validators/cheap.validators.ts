import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import type { Validator, ValidationContext, ValidationResult } from '../types.js';

export class FormatValidator implements Validator {
  name = 'FormatValidator';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const detected = await fileTypeFromBuffer(ctx.buffer);
    const valid =
      detected && ['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(detected.mime);

    if (!valid) {
      return { ok: false, reason: 'INVALID_FORMAT' };
    }
    return { ok: true };
  }
}

export class FileSizeValidator implements Validator {
  name = 'FileSizeValidator';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    if (ctx.buffer.length < ctx.thresholds.minFileBytes) {
      return { ok: false, reason: 'FILE_TOO_SMALL' };
    }
    return { ok: true };
  }
}

export class ResolutionValidator implements Validator {
  name = 'ResolutionValidator';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const width = ctx.metadata.width || 0;
    const height = ctx.metadata.height || 0;

    ctx.metrics.width = width;
    ctx.metrics.height = height;

    if (width < ctx.thresholds.minWidth || height < ctx.thresholds.minHeight) {
      return { ok: false, reason: 'RESOLUTION_TOO_LOW' };
    }
    return { ok: true };
  }
}

export class BlurValidator implements Validator {
  name = 'BlurValidator';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    try {
      // 3x3 standard Laplacian kernel
      const laplacianKernel = {
        width: 3,
        height: 3,
        kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
      };

      const { data } = await sharp(ctx.buffer, { limitInputPixels: 50000000 })
        .greyscale()
        .resize({ width: 512, withoutEnlargement: true })
        .convolve(laplacianKernel)
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Compute variance of pixel intensities
      let sum = 0;
      const len = data.length;
      for (let i = 0; i < len; i++) {
        sum += data[i]!;
      }
      const mean = sum / len;

      let varianceSum = 0;
      for (let i = 0; i < len; i++) {
        const diff = data[i]! - mean;
        varianceSum += diff * diff;
      }
      const variance = varianceSum / len;

      ctx.metrics.blurScore = Math.round(variance * 100) / 100;

      if (variance < ctx.thresholds.blurThreshold) {
        return { ok: false, reason: 'IMAGE_BLURRY' };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'INVALID_FORMAT' };
    }
  }
}

import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { fileTypeFromBuffer } from 'file-type';
import type { Validator, ValidationContext, ReasonCode } from './types.js';
import type { ImageRecord } from '../repositories/image.repository.js';
import { config } from '../config/env.js';
import { logger } from '../infra/logger.js';

export interface PipelineExecutionResult {
  status: 'ACCEPTED' | 'REJECTED';
  reasons: ReasonCode[];
  normalizedBuffer: Buffer;
  metadata: sharp.Metadata;
  metrics: ValidationContext['metrics'];
}

export class ValidationPipeline {
  constructor(
    private cheapValidators: Validator[],
    private faceValidators: Validator[],
    private similarityValidator?: Validator,
  ) {}

  async normalizeBuffer(rawBuffer: Buffer): Promise<{ buffer: Buffer; isHeic: boolean }> {
    const detected = await fileTypeFromBuffer(rawBuffer);
    if (detected && ['image/heic', 'image/heif'].includes(detected.mime)) {
      try {
        const converted = await heicConvert({
          buffer: rawBuffer,
          format: 'JPEG',
          quality: 0.9,
        });
        return { buffer: Buffer.from(converted), isHeic: true };
      } catch (err) {
        logger.warn({ err }, 'Failed to convert HEIC image to JPEG');
        return { buffer: rawBuffer, isHeic: true };
      }
    }
    return { buffer: rawBuffer, isHeic: false };
  }

  async run(row: ImageRecord, rawBuffer: Buffer): Promise<PipelineExecutionResult> {
    const { buffer } = await this.normalizeBuffer(rawBuffer);

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buffer, { failOn: 'none', limitInputPixels: 50000000 }).metadata();
    } catch {
      // Corrupt or undecodable image is normal REJECTED outcome (INVALID_FORMAT)
      return {
        status: 'REJECTED',
        reasons: ['INVALID_FORMAT'],
        normalizedBuffer: buffer,
        metadata: {},
        metrics: {},
      };
    }

    const ctx: ValidationContext = {
      row,
      buffer,
      metadata,
      metrics: {},
      thresholds: config.thresholds,
    };

    const reasons: ReasonCode[] = [];

    // Run cheap validators in order
    let cheapFailed = false;
    for (const validator of this.cheapValidators) {
      const res = await validator.validate(ctx);
      if (!res.ok) {
        reasons.push(res.reason);
        cheapFailed = true;

        // Skip all other checks if FormatValidator fails
        if (res.reason === 'INVALID_FORMAT') {
          return {
            status: 'REJECTED',
            reasons,
            normalizedBuffer: buffer,
            metadata,
            metrics: ctx.metrics,
          };
        }
      }
    }

    // Skip face checks if an earlier cheap check failed (don't pay detection cost on bad files)
    if (!cheapFailed) {
      for (const validator of this.faceValidators) {
        const res = await validator.validate(ctx);
        if (!res.ok) {
          reasons.push(res.reason);
        }
      }
    }

    // Run similarity validator if present and no prior failures
    if (this.similarityValidator && reasons.length === 0) {
      const res = await this.similarityValidator.validate(ctx);
      if (!res.ok) {
        reasons.push(res.reason);
      }
    }

    const status = reasons.length === 0 ? 'ACCEPTED' : 'REJECTED';

    return {
      status,
      reasons,
      normalizedBuffer: buffer,
      metadata,
      metrics: ctx.metrics,
    };
  }
}

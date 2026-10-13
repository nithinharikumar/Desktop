import sharp from 'sharp';
import type { ImageRepository } from '../repositories/image.repository.js';
import type { StorageService } from '../infra/storage/storage.interface.js';
import type { ValidationPipeline } from './pipeline.js';
import { logger } from '../infra/logger.js';
import { config } from '../config/env.js';

export class ValidationWorker {
  constructor(
    private repository: ImageRepository,
    private storage: StorageService,
    private pipeline: ValidationPipeline,
  ) {}

  async processImage(imageId: string): Promise<void> {
    logger.info({ imageId }, 'Starting image validation processing');

    // Find the record
    const stuckJobs = await this.repository.findStuckProcessing();
    const row = stuckJobs.find((r) => r.id === imageId);

    if (!row) {
      logger.warn({ imageId }, 'Image record not found or already processed');
      return;
    }

    if (row.storageKey.startsWith('rejected/')) {
      logger.info({ imageId }, 'Image was already rejected at upload stage');
      return;
    }

    let rawBuffer: Buffer;
    try {
      rawBuffer = await this.storage.getBuffer(row.storageKey);
    } catch (err) {
      logger.error({ err, imageId, key: row.storageKey }, 'Failed to read raw image from storage');
      throw err; // System error triggers retry
    }

    // Run validation pipeline
    const pipelineResult = await this.pipeline.run(row, rawBuffer);
    const { status, reasons, normalizedBuffer, metrics } = pipelineResult;

    let processedKey: string | null = null;
    let thumbnailKey: string | null = null;

    try {
      if (status === 'ACCEPTED') {
        // Auto-rotate by EXIF, STRIP metadata, export q90 JPEG
        const processedBuffer = await sharp(normalizedBuffer, { failOn: 'none' })
          .rotate()
          .jpeg({ quality: 90 })
          .toBuffer();

        processedKey = `processed/${row.ownerId}/${row.id}.jpg`;
        await this.storage.upload(processedKey, processedBuffer, 'image/jpeg');

        // Generate 400px thumbnail
        const thumbBuffer = await sharp(processedBuffer)
          .resize({ width: 400, height: 400, fit: 'inside' })
          .jpeg({ quality: 80 })
          .toBuffer();

        thumbnailKey = `thumbs/${row.ownerId}/${row.id}.jpg`;
        await this.storage.upload(thumbnailKey, thumbBuffer, 'image/jpeg');
      } else {
        // REJECTED: generate thumbnail if decodable so UI can preview
        try {
          const thumbBuffer = await sharp(normalizedBuffer, { failOn: 'none' })
            .rotate()
            .resize({ width: 400, height: 400, fit: 'inside' })
            .jpeg({ quality: 80 })
            .toBuffer();

          thumbnailKey = `thumbs/${row.ownerId}/${row.id}.jpg`;
          await this.storage.upload(thumbnailKey, thumbBuffer, 'image/jpeg');
        } catch {
          // If un-decodable, leave thumbnailKey as null
        }
      }
    } catch (err) {
      logger.error({ err, imageId }, 'Failed during post-processing image save');
      throw err; // Genuine storage error triggers queue retry
    }

    // Commit results
    await this.repository.commitValidationResult(
      row.id,
      row.ownerId,
      status,
      reasons,
      {
        processedKey,
        thumbnailKey,
        width: metrics.width ?? null,
        height: metrics.height ?? null,
        blurScore: metrics.blurScore ?? null,
        faceCount: metrics.faceCount ?? null,
        faceAreaRatio: metrics.faceAreaRatio ?? null,
        phash: metrics.phash ?? null,
      },
      config.thresholds.similarityMaxDistance,
    );

    logger.info({ imageId, status, reasons }, 'Completed image validation processing');
  }
}

import { fileTypeFromBuffer } from 'file-type';
import { v4 as uuidv4 } from 'uuid';
import type { ImageRepository, ImageRecord, FindImagesParams, PaginatedResult } from '../repositories/image.repository.js';
import type { StorageService } from '../infra/storage/storage.interface.js';
import type { QueueService } from '../infra/queue/queue.service.js';
import { AppError } from '../middlewares/errorHandler.js';
import { logger } from '../infra/logger.js';

export interface ImageResponseDto extends Omit<ImageRecord, 'sizeBytes'> {
  sizeBytes: string;
  thumbnailUrl: string | null;
  processedUrl: string | null;
}

export function sanitizeFileName(name: string): string {
  // Strip path characters and weird controls
  const baseName = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
  // Limit length to 100 characters while preserving extension if possible
  if (baseName.length <= 100) return baseName;
  const extIndex = baseName.lastIndexOf('.');
  if (extIndex > 0 && extIndex > baseName.length - 10) {
    const ext = baseName.slice(extIndex);
    return baseName.slice(0, 100 - ext.length) + ext;
  }
  return baseName.slice(0, 100);
}

export class ImageService {
  constructor(
    private repository: ImageRepository,
    private storage: StorageService,
    private queue: QueueService,
  ) {}

  private async toDto(record: ImageRecord): Promise<ImageResponseDto> {
    let thumbnailUrl: string | null = null;
    let processedUrl: string | null = null;

    if (record.thumbnailKey) {
      thumbnailUrl = await this.storage.getSignedUrl(record.thumbnailKey);
    }
    if (record.processedKey) {
      processedUrl = await this.storage.getSignedUrl(record.processedKey);
    }

    return {
      ...record,
      sizeBytes: record.sizeBytes.toString(),
      thumbnailUrl,
      processedUrl,
    };
  }

  async uploadImages(
    ownerId: string,
    files: Array<{ originalname: string; buffer: Buffer; size: number; mimetype: string }>,
  ): Promise<ImageResponseDto[]> {
    if (!files || files.length === 0) {
      throw new AppError(400, 'NO_FILES_PROVIDED', 'At least one file must be provided');
    }
    if (files.length > 20) {
      throw new AppError(400, 'TOO_MANY_FILES', 'Cannot upload more than 20 files in a single batch');
    }

    const results: ImageResponseDto[] = [];

    for (const file of files) {
      const sanitizedName = sanitizeFileName(file.originalname);
      const imageId = uuidv4();
      const detected = await fileTypeFromBuffer(file.buffer);

      const isValidFormat =
        detected &&
        ['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(detected.mime);

      if (!isValidFormat) {
        // Non-jpeg/png/heic -> stored as REJECTED row with INVALID_FORMAT, NO storage upload
        logger.warn(
          { originalName: file.originalname, detectedMime: detected?.mime },
          'File rejected: invalid format detected via magic bytes',
        );

        const rejectedRecord = await this.repository.create({
          id: imageId,
          ownerId,
          originalName: sanitizedName,
          mimeType: detected?.mime || 'unknown',
          sizeBytes: BigInt(file.size),
          storageKey: `rejected/${ownerId}/${imageId}`,
          status: 'REJECTED',
          rejectionReasons: ['INVALID_FORMAT'],
        });

        results.push(await this.toDto(rejectedRecord));
        continue;
      }

      // Valid format: upload raw to storage
      const ext = detected.ext === 'jpg' ? 'jpeg' : detected.ext;
      const storageKey = `raw/${ownerId}/${imageId}.${ext}`;
      await this.storage.upload(storageKey, file.buffer, detected.mime);

      const processingRecord = await this.repository.create({
        id: imageId,
        ownerId,
        originalName: sanitizedName,
        mimeType: detected.mime,
        sizeBytes: BigInt(file.size),
        storageKey,
        status: 'PROCESSING',
      });

      this.queue.enqueue(imageId);
      results.push(await this.toDto(processingRecord));
    }

    return results;
  }

  async getImages(params: FindImagesParams): Promise<PaginatedResult<ImageResponseDto>> {
    const result = await this.repository.findMany(params);
    const dtos = await Promise.all(result.items.map((img) => this.toDto(img)));

    return {
      items: dtos,
      nextCursor: result.nextCursor,
    };
  }

  async getImageById(ownerId: string, id: string): Promise<ImageResponseDto> {
    const image = await this.repository.findById(id, ownerId);
    if (!image) {
      throw new AppError(404, 'IMAGE_NOT_FOUND', `Image ${id} not found`);
    }
    return await this.toDto(image);
  }

  async deleteImage(ownerId: string, id: string): Promise<{ success: boolean; id: string }> {
    const existing = await this.repository.findById(id, ownerId);
    if (!existing) {
      throw new AppError(404, 'IMAGE_NOT_FOUND', `Image ${id} not found`);
    }

    const keysToDelete = [existing.storageKey, existing.processedKey, existing.thumbnailKey].filter(
      (k): k is string => typeof k === 'string' && k.length > 0 && !k.startsWith('rejected/'),
    );

    await this.storage.deleteMany(keysToDelete);
    await this.repository.delete(id, ownerId);

    return { success: true, id };
  }

  async retryImage(ownerId: string, id: string): Promise<ImageResponseDto> {
    const image = await this.repository.findById(id, ownerId);
    if (!image) {
      throw new AppError(404, 'IMAGE_NOT_FOUND', `Image ${id} not found`);
    }

    if (image.status !== 'FAILED') {
      throw new AppError(400, 'INVALID_RETRY', 'Only FAILED images can be retried');
    }

    const updated = await this.repository.update(id, ownerId, {
      status: 'PROCESSING',
      attempts: 0,
      rejectionReasons: [],
    });

    if (!updated) {
      throw new AppError(500, 'UPDATE_FAILED', 'Failed to reset image status for retry');
    }

    this.queue.enqueue(id);
    return await this.toDto(updated);
  }
}

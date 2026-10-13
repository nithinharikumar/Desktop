import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  FormatValidator,
  FileSizeValidator,
  ResolutionValidator,
  BlurValidator,
} from './validators/cheap.validators.js';
import { ValidationPipeline } from './pipeline.js';
import type { ImageRecord } from '../repositories/image.repository.js';

describe('Validation Pipeline - Cheap Validators (Phase 3)', () => {
  const cheapValidators = [
    new FormatValidator(),
    new FileSizeValidator(),
    new ResolutionValidator(),
    new BlurValidator(),
  ];

  const pipeline = new ValidationPipeline(cheapValidators, []);

  function mockRow(id: string = 'test-id'): ImageRecord {
    return {
      id,
      ownerId: 'owner-1',
      originalName: 'test.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(100000),
      width: null,
      height: null,
      storageKey: `raw/owner-1/${id}.jpg`,
      processedKey: null,
      thumbnailKey: null,
      status: 'PROCESSING',
      rejectionReasons: [],
      phash: null,
      blurScore: null,
      faceCount: null,
      faceAreaRatio: null,
      attempts: 0,
      createdAt: new Date(),
      processedAt: null,
    };
  }

  it('rejects corrupt bytes with INVALID_FORMAT', async () => {
    const corruptBuffer = Buffer.from('definitely not an image payload');
    const result = await pipeline.run(mockRow(), corruptBuffer);

    expect(result.status).toBe('REJECTED');
    expect(result.reasons).toContain('INVALID_FORMAT');
  });

  it('rejects image that is smaller than MIN_FILE_BYTES (FILE_TOO_SMALL)', async () => {
    // Generate valid 700x700 image but with very high compression so byte size < 51200 bytes
    const tinyByteImg = await sharp({
      create: {
        width: 700,
        height: 700,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .jpeg({ quality: 10 })
      .toBuffer();

    expect(tinyByteImg.length).toBeLessThan(51200);

    const result = await pipeline.run(mockRow(), tinyByteImg);
    expect(result.status).toBe('REJECTED');
    expect(result.reasons).toContain('FILE_TOO_SMALL');
  });

  it('rejects image below MIN_WIDTH or MIN_HEIGHT (RESOLUTION_TOO_LOW)', async () => {
    // 300x300 image padded with random noise to exceed 51200 bytes
    const noise = Buffer.alloc(100000);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);

    const lowResImg = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .composite([{ input: noise.subarray(0, 300 * 300), raw: { width: 300, height: 300, channels: 1 } }])
      .jpeg({ quality: 100 })
      .toBuffer();

    const result = await pipeline.run(mockRow(), lowResImg);
    expect(result.status).toBe('REJECTED');
    expect(result.reasons).toContain('RESOLUTION_TOO_LOW');
  });

  it('rejects heavily blurred image (IMAGE_BLURRY)', async () => {
    // Create large 800x800 image, fill with gradient, then apply heavy gaussian blur
    const blurredImg = await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
      },
    })
      .blur(30)
      .jpeg({ quality: 90 })
      .toBuffer();

    const result = await pipeline.run(mockRow(), blurredImg);
    expect(result.status).toBe('REJECTED');
    expect(result.reasons).toContain('IMAGE_BLURRY');
    expect(result.metrics.blurScore).toBeDefined();
    expect(result.metrics.blurScore!).toBeLessThan(100);
  });

  it('accepts crisp, high-resolution image with sufficient size and sharpness', async () => {
    // Generate 1000x1000 image with high contrast checkerboard pattern to ensure size > 51200
    const width = 1000;
    const height = 1000;
    const channels = 3;
    const rawPixels = Buffer.alloc(width * height * channels);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const isWhite = ((Math.floor(x / 10) + Math.floor(y / 10)) % 2) === 0;
        const offset = (y * width + x) * channels;
        const val = isWhite ? 255 : 0;
        rawPixels[offset] = val;
        rawPixels[offset + 1] = val;
        rawPixels[offset + 2] = val;
      }
    }

    const crispImg = await sharp(rawPixels, { raw: { width, height, channels } })
      .jpeg({ quality: 95 })
      .toBuffer();

    expect(crispImg.length).toBeGreaterThan(51200);

    const result = await pipeline.run(mockRow(), crispImg);
    expect(result.status).toBe('ACCEPTED');
    expect(result.reasons).toHaveLength(0);
    expect(result.metrics.blurScore).toBeGreaterThanOrEqual(100);
  });
});

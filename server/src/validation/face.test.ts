import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import type { FaceDetector, FaceDetection } from '../infra/face/faceDetector.interface.js';
import { FaceCountValidator, FaceSizeValidator } from './validators/face.validators.js';
import type { ValidationContext } from './types.js';
import type { ImageRecord } from '../repositories/image.repository.js';
import { loadThresholds } from '../config/thresholds.js';

class MockFaceDetector implements FaceDetector {
  public detections: FaceDetection[] = [];

  async init(): Promise<void> {}

  async detectFaces(_imageBuffer: Buffer): Promise<FaceDetection[]> {
    return this.detections;
  }
}

describe('Face Validation Rules (Phase 4)', () => {
  const mockDetector = new MockFaceDetector();
  const countValidator = new FaceCountValidator(mockDetector);
  const sizeValidator = new FaceSizeValidator(mockDetector);
  const thresholds = loadThresholds({});

  function createMockContext(width = 800, height = 800): ValidationContext {
    const row: ImageRecord = {
      id: 'mock-id',
      ownerId: 'owner-1',
      originalName: 'selfie.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(200000),
      width,
      height,
      storageKey: 'raw/owner-1/mock.jpg',
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

    return {
      row,
      buffer: Buffer.alloc(100),
      metadata: { width, height } as sharp.Metadata,
      metrics: {},
      thresholds,
    };
  }

  it('rejects when 0 faces are detected (NO_FACE_DETECTED)', async () => {
    mockDetector.detections = [];
    const ctx = createMockContext();

    const countRes = await countValidator.validate(ctx);
    expect(countRes.ok).toBe(false);
    if (!countRes.ok) {
      expect(countRes.reason).toBe('NO_FACE_DETECTED');
    }
    expect(ctx.metrics.faceCount).toBe(0);
  });

  it('rejects when multiple faces (>1) are detected (MULTIPLE_FACES)', async () => {
    mockDetector.detections = [
      { box: { x: 100, y: 100, width: 150, height: 150 }, score: 0.95 },
      { box: { x: 400, y: 100, width: 140, height: 140 }, score: 0.88 },
    ];
    const ctx = createMockContext();

    const countRes = await countValidator.validate(ctx);
    expect(countRes.ok).toBe(false);
    if (!countRes.ok) {
      expect(countRes.reason).toBe('MULTIPLE_FACES');
    }
    expect(ctx.metrics.faceCount).toBe(2);
  });

  it('rejects when face is too small relative to the frame (FACE_TOO_SMALL)', async () => {
    // 800x800 image (area 640000). Face bbox 40x40 (area 1600).
    // Area ratio = 1600 / 640000 = 0.0025 < 0.05
    mockDetector.detections = [
      { box: { x: 380, y: 380, width: 40, height: 40 }, score: 0.92 },
    ];
    const ctx = createMockContext(800, 800);

    const countRes = await countValidator.validate(ctx);
    expect(countRes.ok).toBe(true);

    const sizeRes = await sizeValidator.validate(ctx);
    expect(sizeRes.ok).toBe(false);
    if (!sizeRes.ok) {
      expect(sizeRes.reason).toBe('FACE_TOO_SMALL');
    }
    expect(ctx.metrics.faceAreaRatio).toBeLessThan(thresholds.minFaceAreaRatio);
  });

  it('accepts when exactly 1 prominent face is detected with sufficient area ratio', async () => {
    // 800x800 image (area 640000). Face bbox 300x300 (area 90000).
    // Area ratio = 90000 / 640000 = 0.1406 >= 0.05
    mockDetector.detections = [
      { box: { x: 250, y: 200, width: 300, height: 300 }, score: 0.98 },
    ];
    const ctx = createMockContext(800, 800);

    const countRes = await countValidator.validate(ctx);
    expect(countRes.ok).toBe(true);

    const sizeRes = await sizeValidator.validate(ctx);
    expect(sizeRes.ok).toBe(true);
    expect(ctx.metrics.faceCount).toBe(1);
    expect(ctx.metrics.faceAreaRatio).toBeGreaterThanOrEqual(thresholds.minFaceAreaRatio);
  });
});

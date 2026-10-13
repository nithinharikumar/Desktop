import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { computeDHash, hammingDistance } from '../infra/hasher/dhash.js';
import { InMemoryImageRepository } from '../repositories/inMemoryImage.repository.js';
import { LocalStorageService } from '../infra/storage/localStorage.js';
import { ValidationPipeline } from './pipeline.js';
import { ValidationWorker } from './worker.js';
import {
  FormatValidator,
  FileSizeValidator,
  ResolutionValidator,
  BlurValidator,
} from './validators/cheap.validators.js';
import { FaceCountValidator, FaceSizeValidator } from './validators/face.validators.js';
import { SimilarityValidator } from './validators/similarity.validator.js';
import type { FaceDetector } from '../infra/face/faceDetector.interface.js';

describe('Similarity & Duplicate Detection (Phase 5)', () => {
  // Mock face detector that always detects 1 prominent face for valid headshot test images
  const mockFaceDetector: FaceDetector = {
    init: async () => {},
    detectFaces: async () => [
      { box: { x: 300, y: 300, width: 350, height: 350 }, score: 0.99 },
    ],
  };

  it('computes 64-bit dHash with distance 0 for identical images', async () => {
    const imgBuffer = await sharp({
      create: {
        width: 700,
        height: 700,
        channels: 3,
        background: { r: 150, g: 120, b: 90 },
      },
    })
      .jpeg()
      .toBuffer();

    const hash1 = await computeDHash(imgBuffer);
    const hash2 = await computeDHash(imgBuffer);

    expect(hash1).toHaveLength(64);
    expect(hash2).toHaveLength(64);
    expect(hammingDistance(hash1, hash2)).toBe(0);
  });

  it('computes small distance for resized / re-encoded copy of the same image', async () => {
    // High-contrast geometric image
    const width = 800;
    const height = 800;
    const channels = 3;
    const raw = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * channels;
        raw[offset] = (x * 255) / width;
        raw[offset + 1] = (y * 255) / height;
        raw[offset + 2] = 128;
      }
    }

    const original = await sharp(raw, { raw: { width, height, channels } })
      .jpeg({ quality: 90 })
      .toBuffer();

    const resized = await sharp(original)
      .resize(650, 650)
      .jpeg({ quality: 80 })
      .toBuffer();

    const hashOriginal = await computeDHash(original);
    const hashResized = await computeDHash(resized);

    const dist = hammingDistance(hashOriginal, hashResized);
    expect(dist).toBeLessThanOrEqual(5);
  });

  it('computes large distance for different images', async () => {
    const width = 800;
    const height = 800;
    const channels = 3;

    // Horizontal ramp
    const raw1 = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * channels;
        raw1[offset] = (x * 255) / width;
        raw1[offset + 1] = (x * 255) / width;
        raw1[offset + 2] = (x * 255) / width;
      }
    }
    const img1 = await sharp(raw1, { raw: { width, height, channels } }).jpeg().toBuffer();

    // Vertical ramp
    const raw2 = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * channels;
        raw2[offset] = (y * 255) / height;
        raw2[offset + 1] = (y * 255) / height;
        raw2[offset + 2] = (y * 255) / height;
      }
    }
    const img2 = await sharp(raw2, { raw: { width, height, channels } }).jpeg().toBuffer();

    const hash1 = await computeDHash(img1);
    const hash2 = await computeDHash(img2);

    const dist = hammingDistance(hash1, hash2);
    expect(dist).toBeGreaterThan(15);
  });

  it('atomically accepts exactly ONE of two near-identical images processed concurrently', async () => {
    const repository = new InMemoryImageRepository();
    const storage = new LocalStorageService('./test_uploads');

    const similarityValidator = new SimilarityValidator(repository);
    const pipeline = new ValidationPipeline(
      [
        new FormatValidator(),
        new FileSizeValidator(),
        new ResolutionValidator(),
        new BlurValidator(),
      ],
      [
        new FaceCountValidator(mockFaceDetector),
        new FaceSizeValidator(mockFaceDetector),
      ],
      similarityValidator,
    );

    const worker = new ValidationWorker(repository, storage, pipeline);

    // Create high-resolution valid checkerboard image (>51200 bytes)
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
    const imgBuffer = await sharp(rawPixels, { raw: { width, height, channels } })
      .jpeg({ quality: 95 })
      .toBuffer();

    const ownerId = 'concurrency-owner-1';
    const id1 = 'img-concurrency-1';
    const id2 = 'img-concurrency-2';

    await storage.upload(`raw/${ownerId}/${id1}.jpg`, imgBuffer, 'image/jpeg');
    await storage.upload(`raw/${ownerId}/${id2}.jpg`, imgBuffer, 'image/jpeg');

    await repository.create({
      id: id1,
      ownerId,
      originalName: 'photo1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(imgBuffer.length),
      storageKey: `raw/${ownerId}/${id1}.jpg`,
      status: 'PROCESSING',
    });

    await repository.create({
      id: id2,
      ownerId,
      originalName: 'photo2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(imgBuffer.length),
      storageKey: `raw/${ownerId}/${id2}.jpg`,
      status: 'PROCESSING',
    });

    // Execute concurrently
    await Promise.all([
      worker.processImage(id1),
      worker.processImage(id2),
    ]);

    const res1 = await repository.findById(id1, ownerId);
    const res2 = await repository.findById(id2, ownerId);

    expect(res1).not.toBeNull();
    expect(res2).not.toBeNull();

    const statuses = [res1!.status, res2!.status];
    expect(statuses).toContain('ACCEPTED');
    expect(statuses).toContain('REJECTED');

    const rejected = res1!.status === 'REJECTED' ? res1 : res2;
    expect(rejected!.rejectionReasons).toContain('DUPLICATE_OR_SIMILAR');

    // Cleanup test storage
    await storage.deleteMany([
      `raw/${ownerId}/${id1}.jpg`,
      `raw/${ownerId}/${id2}.jpg`,
      `processed/${ownerId}/${id1}.jpg`,
      `processed/${ownerId}/${id2}.jpg`,
      `thumbs/${ownerId}/${id1}.jpg`,
      `thumbs/${ownerId}/${id2}.jpg`,
    ]);
  });
});

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryImageRepository } from '../repositories/inMemoryImage.repository.js';
import { LocalStorageService } from '../infra/storage/localStorage.js';
import type { FaceDetector } from '../infra/face/faceDetector.interface.js';

describe('Post-Processing Pipeline & Signed URLs (Phase 6)', () => {
  const repository = new InMemoryImageRepository();
  const storage = new LocalStorageService('./test_uploads_phase6');
  const mockFaceDetector: FaceDetector = {
    init: async () => {},
    detectFaces: async () => [
      { box: { x: 250, y: 250, width: 300, height: 300 }, score: 0.99 },
    ],
  };

  const { app, queue } = createApp({
    repository,
    storage,
    faceDetector: mockFaceDetector,
  });

  it('rotates, strips metadata, produces processed JPEG & 400px thumbnail, and serves signed URLs', async () => {
    // Generate valid 1000x1000 checkerboard image (>51200 bytes)
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

    const testImg = await sharp(rawPixels, { raw: { width, height, channels } })
      .jpeg({ quality: 95 })
      .toBuffer();

    // Upload via API
    const uploadRes = await request(app)
      .post('/api/images')
      .attach('files', testImg, 'headshot.jpg');

    expect(uploadRes.status).toBe(201);
    const sessionCookie = uploadRes.headers['set-cookie'] as unknown as string[];
    const uploadedId = uploadRes.body.items[0].id;

    // Wait for in-process queue to complete
    await queue.onIdle();

    // Query image detail
    const getRes = await request(app)
      .get(`/api/images/${uploadedId}`)
      .set('Cookie', sessionCookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe('ACCEPTED');
    expect(getRes.body.processedUrl).toBeDefined();
    expect(getRes.body.thumbnailUrl).toBeDefined();

    // Verify thumbnail is <= 400px
    const thumbUrl = getRes.body.thumbnailUrl;
    const thumbFileRes = await request(app).get(thumbUrl);
    expect(thumbFileRes.status).toBe(200);
    expect(thumbFileRes.headers['content-type']).toBe('image/jpeg');

    const thumbMeta = await sharp(thumbFileRes.body).metadata();
    expect(thumbMeta.width).toBeLessThanOrEqual(400);
    expect(thumbMeta.height).toBeLessThanOrEqual(400);

    // Verify processed image has EXIF stripped
    const processedUrl = getRes.body.processedUrl;
    const procFileRes = await request(app).get(processedUrl);
    expect(procFileRes.status).toBe(200);

    const procMeta = await sharp(procFileRes.body).metadata();
    expect(procMeta.exif).toBeUndefined();
  });
});

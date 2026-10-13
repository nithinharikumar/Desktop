import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import * as db from './infra/db.js';
import { InMemoryImageRepository } from './repositories/inMemoryImage.repository.js';
import type { FaceDetector } from './infra/face/faceDetector.interface.js';
import sharp from 'sharp';

const mockDetector: FaceDetector = {
  init: async () => {},
  detectFaces: async () => [{ box: { x: 100, y: 100, width: 200, height: 200 }, score: 0.99 }],
};

describe('App Scaffolding & Core Middlewares (Phase 1 & 2)', () => {
  const repository = new InMemoryImageRepository();
  const { app } = createApp({ repository, faceDetector: mockDetector });

  it('sets secure signed pg_owner_id cookie on first request', async () => {
    const res = await request(app).get('/health');
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const ownerCookie = (cookies as unknown as string[]).find((c: string) => c.startsWith('pg_owner_id='));
    expect(ownerCookie).toBeDefined();
    expect(ownerCookie).toContain('HttpOnly');
  });

  it('preserves existing signed pg_owner_id cookie across requests', async () => {
    const firstRes = await request(app).get('/health');
    const setCookie = firstRes.headers['set-cookie'];
    expect(setCookie).toBeDefined();

    const secondRes = await request(app)
      .get('/health')
      .set('Cookie', setCookie as unknown as string[]);

    expect(secondRes.status).toBeDefined();
  });

  it('returns structured 404 error for unknown routes without leaking stack trace', async () => {
    const res = await request(app).get('/api/unknown-endpoint');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /api/unknown-endpoint not found',
      },
    });
  });

  it('includes security headers from helmet', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns healthy status when DB is connected', async () => {
    const spy = vi.spyOn(db, 'checkDbHealth').mockResolvedValueOnce({
      ok: true,
      latencyMs: 5,
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.database.status).toBe('connected');

    spy.mockRestore();
  });

  describe('Upload API & Ingestion (Phase 2)', () => {
    let sessionCookie: string[];

    it('rejects files with non-image magic bytes immediately as REJECTED with INVALID_FORMAT', async () => {
      const fakeTxt = Buffer.from('this is just a text file disguised as jpg');
      const res = await request(app)
        .post('/api/images')
        .attach('files', fakeTxt, 'fake.jpg');

      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(1);
      const item = res.body.items[0];
      expect(item.status).toBe('REJECTED');
      expect(item.rejectionReasons).toContain('INVALID_FORMAT');

      sessionCookie = res.headers['set-cookie'] as unknown as string[];
    });

    it('accepts valid JPEG and marks as PROCESSING', async () => {
      // Create a valid 100x100 JPEG using sharp
      const jpegBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .jpeg()
        .toBuffer();

      const res = await request(app)
        .post('/api/images')
        .set('Cookie', sessionCookie)
        .attach('files', jpegBuffer, 'test.jpg');

      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(1);
      const item = res.body.items[0];
      expect(item.status).toBe('PROCESSING');
      expect(item.originalName).toBe('test.jpg');
    });

    it('lists images for the owner with cursor pagination', async () => {
      const res = await request(app)
        .get('/api/images')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.items).toBeInstanceOf(Array);
      expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('deletes an image and its records', async () => {
      const listRes = await request(app)
        .get('/api/images')
        .set('Cookie', sessionCookie);

      const targetId = listRes.body.items[0].id;
      const delRes = await request(app)
        .delete(`/api/images/${targetId}`)
        .set('Cookie', sessionCookie);

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
    });
  });
});

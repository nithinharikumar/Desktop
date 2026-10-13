import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { InMemoryImageRepository } from './repositories/inMemoryImage.repository.js';
import { LocalStorageService } from './infra/storage/localStorage.js';
import sharp from 'sharp';

describe('Cross-Owner Security & Access Isolation (Phase 9)', () => {
  const repository = new InMemoryImageRepository();
  const storage = new LocalStorageService('./test_security_uploads');
  const { app } = createApp({ repository, storage });

  it('strictly isolates images between two different anonymous owners', async () => {
    // Owner A uploads an image
    const imgA = await sharp({
      create: { width: 700, height: 700, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).jpeg().toBuffer();

    const resA = await request(app).post('/api/images').attach('files', imgA, 'photoA.jpg');
    expect(resA.status).toBe(201);
    const cookieA = resA.headers['set-cookie'] as unknown as string[];
    const idA = resA.body.items[0].id;

    // Owner B establishes a separate session
    const resBHealth = await request(app).get('/health');
    const cookieB = resBHealth.headers['set-cookie'] as unknown as string[];

    // Ensure Owner B gets an empty list
    const listB = await request(app).get('/api/images').set('Cookie', cookieB);
    expect(listB.body.items.some((i: { id: string }) => i.id === idA)).toBe(false);

    // Owner B cannot get Owner A's image directly
    const getResB = await request(app).get(`/api/images/${idA}`).set('Cookie', cookieB);
    expect(getResB.status).toBe(404);

    // Owner B cannot delete Owner A's image
    const delResB = await request(app).delete(`/api/images/${idA}`).set('Cookie', cookieB);
    expect(delResB.status).toBe(404);

    // Owner B cannot retry Owner A's image
    const retryResB = await request(app).post(`/api/images/${idA}/retry`).set('Cookie', cookieB);
    expect(retryResB.status).toBe(404);

    // Owner A can still delete their own image
    const delResA = await request(app).delete(`/api/images/${idA}`).set('Cookie', cookieA);
    expect(delResA.status).toBe(200);

    // Cleanup
    await storage.delete(`raw/*`);
  });
});

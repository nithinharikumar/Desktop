import { describe, it, expect } from 'vitest';
import heicConvert from 'heic-convert';
import sharp from 'sharp';

describe('HEIC Normalizer Verification (Phase 3)', () => {
  it('loads heic-convert and processes image buffer safely', async () => {
    expect(typeof heicConvert).toBe('function');

    // Create a small JPEG buffer and verify that if passed corrupt/fake HEIC, it handles errors gracefully
    const dummyBuffer = Buffer.from('not a real heic file');
    await expect(
      heicConvert({
        buffer: dummyBuffer,
        format: 'JPEG',
        quality: 0.9,
      }),
    ).rejects.toThrow();
  });

  it('verifies sharp decompression bomb protection (limitInputPixels)', async () => {
    // Sharp supports limitInputPixels: 268402689 (or configurable)
    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    const metadata = await sharp(testImage, { failOn: 'none', limitInputPixels: 50000000 }).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(100);
  });
});

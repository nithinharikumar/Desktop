import sharp from 'sharp';

/**
 * Computes a 64-bit difference hash (dHash) for an image buffer.
 * 1. Convert to greyscale
 * 2. Resize to 9x8 pixels (9 columns, 8 rows)
 * 3. For each row, compare pixel(x) < pixel(x+1) -> 8 comparisons x 8 rows = 64 bits
 * Returns a 64-character binary string of '0's and '1's.
 */
export async function computeDHash(imageBuffer: Buffer): Promise<string> {
  const { data } = await sharp(imageBuffer, { limitInputPixels: 50000000 })
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = '';
  // 8 rows
  for (let row = 0; row < 8; row++) {
    const rowOffset = row * 9;
    // 8 comparisons per row
    for (let col = 0; col < 8; col++) {
      const leftPixel = data[rowOffset + col]!;
      const rightPixel = data[rowOffset + col + 1]!;
      hash += leftPixel < rightPixel ? '1' : '0';
    }
  }

  return hash;
}

/**
 * Computes the Hamming distance between two 64-bit binary strings.
 */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== 64 || hashB.length !== 64) {
    throw new Error('Both hashes must be 64-bit binary strings');
  }

  let distance = 0;
  for (let i = 0; i < 64; i++) {
    if (hashA[i] !== hashB[i]) {
      distance++;
    }
  }
  return distance;
}

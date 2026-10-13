import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { StorageService } from './storage.interface.js';
import { config } from '../../config/env.js';
import { logger } from '../logger.js';

export class LocalStorageService implements StorageService {
  private baseDir: string;
  private secret: string;

  constructor(baseDir: string = config.env.UPLOAD_DIR, secret: string = config.env.COOKIE_SECRET) {
    this.baseDir = path.resolve(baseDir);
    this.secret = secret;
  }

  private getFilePath(key: string): string {
    // Prevent directory traversal attacks
    const safeKey = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.join(this.baseDir, safeKey);
  }

  async upload(key: string, buffer: Buffer, _contentType: string): Promise<void> {
    const fullPath = this.getFilePath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
  }

  async getSignedUrl(key: string, expiresInSeconds: number = 300): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const dataToSign = `${key}:${expires}`;
    const sig = crypto.createHmac('sha256', this.secret).update(dataToSign).digest('hex');

    return `/api/files/${encodeURIComponent(key)}?expires=${expires}&sig=${sig}`;
  }

  verifySignature(key: string, expires: number, sig: string): boolean {
    if (Date.now() / 1000 > expires) {
      return false;
    }
    const dataToSign = `${key}:${expires}`;
    const expectedSig = crypto.createHmac('sha256', this.secret).update(dataToSign).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFilePath(key);
    try {
      await fs.unlink(fullPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error({ err, key }, 'Failed to delete file');
      }
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => this.delete(k)));
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.getFilePath(key);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getBuffer(key: string): Promise<Buffer> {
    const fullPath = this.getFilePath(key);
    return await fs.readFile(fullPath);
  }
}

export const defaultStorage = new LocalStorageService();

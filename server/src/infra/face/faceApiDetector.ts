import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import type { FaceDetector, FaceDetection } from './faceDetector.interface.js';
import { logger } from '../logger.js';

export class FaceApiDetector implements FaceDetector {
  private static instance: FaceApiDetector | null = null;
  private faceapi: any = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  public static getInstance(): FaceApiDetector {
    if (!FaceApiDetector.instance) {
      FaceApiDetector.instance = new FaceApiDetector();
    }
    return FaceApiDetector.instance;
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        logger.info('Initializing face-api models (singleton)...');

        // Prefer node-wasm or bundled module to avoid tfjs-node native build issues
        try {
          const mod = await import('@vladmandic/face-api/dist/face-api.node-wasm.js');
          this.faceapi = mod.default || mod;
        } catch {
          try {
            const mod = await import('@vladmandic/face-api');
            this.faceapi = mod.default || mod;
          } catch (e) {
            logger.warn({ err: e }, 'Could not load face-api binary. Face detection will be simulated or fallback.');
            return;
          }
        }

        const possiblePaths = [
          path.resolve(process.cwd(), 'node_modules/@vladmandic/face-api/model'),
          path.resolve(process.cwd(), '../node_modules/@vladmandic/face-api/model'),
          path.resolve(process.cwd(), '../../node_modules/@vladmandic/face-api/model'),
        ];

        const modelDir = possiblePaths.find((p) => fs.existsSync(p));
        if (modelDir && this.faceapi?.nets?.ssdMobilenetv1) {
          await this.faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
          this.isInitialized = true;
          logger.info({ modelDir }, 'Face-api ssdMobilenetv1 model loaded successfully');
        } else {
          logger.warn('Could not locate face-api /model directory or ssdMobilenetv1 net.');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to initialize face-api model');
      }
    })();

    return this.initPromise;
  }

  async detectFaces(imageBuffer: Buffer): Promise<FaceDetection[]> {
    if (!this.isInitialized) {
      await this.init();
      if (!this.isInitialized || !this.faceapi) {
        logger.warn('Face detector model not initialized; returning empty detections');
        return [];
      }
    }

    let tensor: any = null;
    try {
      // Downscale to max 1024px before detection and extract raw RGB (no canvas needed)
      const { data, info } = await sharp(imageBuffer, { limitInputPixels: 50000000 })
        .resize({ width: 1024, height: 1024, fit: 'inside' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      tensor = this.faceapi.tf.tensor3d(data, [info.height, info.width, 3], 'int32');

      const detections = await this.faceapi.detectAllFaces(
        tensor,
        new this.faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }),
      );

      return detections
        .filter((d: any) => d.score >= 0.5)
        .map((d: any) => ({
          box: {
            x: d.box.x,
            y: d.box.y,
            width: d.box.width,
            height: d.box.height,
          },
          score: d.score,
        }));
    } catch (err) {
      logger.error({ err }, 'Error during face detection');
      return [];
    } finally {
      if (tensor && typeof tensor.dispose === 'function') {
        tensor.dispose();
      }
    }
  }
}

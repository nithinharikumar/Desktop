import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import type { ImageController } from '../controllers/image.controller.js';
import { config } from '../config/env.js';
import type { LocalStorageService } from '../infra/storage/localStorage.js';
import { AppError } from '../middlewares/errorHandler.js';

export function createImageRouter(controller: ImageController): Router {
  const router = Router();

  // Memory storage for multer so we can sniff magic bytes and process in memory
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.thresholds.maxUploadBytes, // 15MB
      files: 20,
    },
  });

  // Rate limiting on uploads to protect against abuse
  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 upload requests per windowMs
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many upload requests. Please try again later.',
      },
    },
  });

  router.post('/', uploadLimiter, upload.array('files', 20), controller.upload);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.delete('/:id', controller.delete);
  router.post('/:id/retry', controller.retry);

  return router;
}

export function createFileRouter(storage: LocalStorageService): Router {
  const router = Router();

  // GET /api/files/:key(*)
  router.get('/*', async (req, res, next) => {
    try {
      const params = req.params as Record<string, string>;
      const key = decodeURIComponent(params['0'] || '');
      const expires = Number(req.query['expires']);
      const sig = String(req.query['sig'] || '');

      // Verify HMAC signature and expiry
      const isValid = storage.verifySignature(key, expires, sig);
      if (!isValid) {
        throw new AppError(403, 'FORBIDDEN', 'Invalid or expired file signature');
      }

      const exists = await storage.exists(key);
      if (!exists) {
        throw new AppError(404, 'NOT_FOUND', 'Requested file does not exist');
      }

      const buffer = await storage.getBuffer(key);

      // Determine content type based on extension
      let contentType = 'application/octet-stream';
      if (key.endsWith('.jpg') || key.endsWith('.jpeg')) contentType = 'image/jpeg';
      else if (key.endsWith('.png')) contentType = 'image/png';
      else if (key.endsWith('.webp')) contentType = 'image/webp';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

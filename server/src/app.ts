import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { config } from './config/env.js';
import { logger } from './infra/logger.js';
import { ownerIdMiddleware } from './middlewares/ownerId.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { createImageRouter, createFileRouter } from './routes/image.routes.js';
import { ImageController } from './controllers/image.controller.js';
import { ImageService } from './services/image.service.js';
import type { ImageRepository } from './repositories/image.repository.js';
import { PrismaImageRepository } from './repositories/image.repository.js';
import { InMemoryImageRepository } from './repositories/inMemoryImage.repository.js';
import type { StorageService } from './infra/storage/storage.interface.js';
import { LocalStorageService, defaultStorage } from './infra/storage/localStorage.js';
import type { QueueService } from './infra/queue/queue.service.js';
import { InProcessQueueService } from './infra/queue/queue.service.js';

import {
  FormatValidator,
  FileSizeValidator,
  ResolutionValidator,
  BlurValidator,
} from './validation/validators/cheap.validators.js';
import {
  FaceCountValidator,
  FaceSizeValidator,
} from './validation/validators/face.validators.js';
import { FaceApiDetector } from './infra/face/faceApiDetector.js';
import type { FaceDetector } from './infra/face/faceDetector.interface.js';
import { SimilarityValidator } from './validation/validators/similarity.validator.js';
import { ValidationPipeline } from './validation/pipeline.js';
import { ValidationWorker } from './validation/worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppDependencies {
  repository?: ImageRepository;
  storage?: StorageService;
  queue?: QueueService;
  faceDetector?: FaceDetector;
  pipeline?: ValidationPipeline;
}

export function createApp(deps: AppDependencies = {}): {
  app: Express;
  repository: ImageRepository;
  storage: StorageService;
  queue: QueueService;
  service: ImageService;
  pipeline: ValidationPipeline;
} {
  const repository =
    deps.repository ||
    (config.env.DATABASE_URL
      ? new PrismaImageRepository()
      : new InMemoryImageRepository());

  const storage = deps.storage || defaultStorage;
  const queue = deps.queue || new InProcessQueueService(repository);
  const faceDetector = deps.faceDetector || FaceApiDetector.getInstance();

  const pipeline =
    deps.pipeline ||
    new ValidationPipeline(
      [
        new FormatValidator(),
        new FileSizeValidator(),
        new ResolutionValidator(),
        new BlurValidator(),
      ],
      [
        new FaceCountValidator(faceDetector),
        new FaceSizeValidator(faceDetector),
      ],
      new SimilarityValidator(repository),
    );

  const worker = new ValidationWorker(repository, storage, pipeline);
  queue.setProcessor((imageId) => worker.processImage(imageId));

  const imageService = new ImageService(repository, storage, queue);
  const imageController = new ImageController(imageService);

  const app = express();

  // Security Headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Strict CORS
  app.use(
    cors({
      origin: config.env.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // Cookie Parser for signed ownerId cookies
  app.use(cookieParser(config.env.COOKIE_SECRET));

  // Request Body Parsers
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // HTTP Request Logging (suppress /health to reduce noise in logs)
  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === '/health',
      },
    }),
  );

  // Anonymous identity session middleware
  app.use(ownerIdMiddleware);

  // Health Check route
  app.use('/health', healthRouter);

  // Image API routes & File delivery
  const localStorageInst = storage instanceof LocalStorageService ? storage : new LocalStorageService();
  app.use('/api/images', createImageRouter(imageController));
  app.use('/api/files', createFileRouter(localStorageInst));

  // Serve client in production if built client exists
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
        return next();
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Error Handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, repository, storage, queue, service: imageService, pipeline };
}

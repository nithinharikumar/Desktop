import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../infra/logger.js';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    logger.warn({ err, path: req.path }, `Handled application error: ${err.message}`);
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    logger.warn({ issues: err.issues, path: req.path }, 'Input validation failed');
    const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: message || 'Invalid input data',
      },
    });
    return;
  }

  // Handle Multer upload errors
  if (err && typeof err === 'object' && 'name' in err && err.name === 'MulterError') {
    const multerErr = err as unknown as { code: string; message: string };
    logger.warn({ multerErr, path: req.path }, 'Multer upload error');
    res.status(400).json({
      error: {
        code: 'UPLOAD_ERROR',
        message: multerErr.message,
      },
    });
    return;
  }

  // Unknown internal server error - never leak stack trace or internal messages to client
  logger.error({ err, path: req.path }, 'Unhandled internal server error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
    },
  });
}

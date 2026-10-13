import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { ImageService } from '../services/image.service.js';
import { AppError } from '../middlewares/errorHandler.js';

const getImagesQuerySchema = z.object({
  status: z.enum(['PROCESSING', 'ACCEPTED', 'REJECTED', 'FAILED']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

const idParamSchema = z.object({
  id: z.string().uuid('Invalid image UUID format'),
});

export class ImageController {
  constructor(private service: ImageService) {}

  upload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        throw new AppError(400, 'NO_FILES_PROVIDED', 'No files uploaded. Provide files under the "files" field.');
      }

      const results = await this.service.uploadImages(req.ownerId, files);
      res.status(201).json({ items: results });
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = getImagesQuerySchema.parse(req.query);
      const result = await this.service.getImages({
        ownerId: req.ownerId,
        status: query.status,
        cursor: query.cursor,
        limit: query.limit,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = idParamSchema.parse(req.params);
      const item = await this.service.getImageById(req.ownerId, params.id);
      res.status(200).json(item);
    } catch (err) {
      next(err);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = idParamSchema.parse(req.params);
      const result = await this.service.deleteImage(req.ownerId, params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  retry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = idParamSchema.parse(req.params);
      const item = await this.service.retryImage(req.ownerId, params.id);
      res.status(200).json(item);
    } catch (err) {
      next(err);
    }
  };
}

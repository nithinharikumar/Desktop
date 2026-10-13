import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';

export const COOKIE_NAME = 'pg_owner_id';

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      ownerId: string;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export function ownerIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existingOwnerId = req.signedCookies ? (req.signedCookies[COOKIE_NAME] as string | undefined) : undefined;

  if (existingOwnerId && typeof existingOwnerId === 'string' && existingOwnerId.trim().length > 0) {
    req.ownerId = existingOwnerId;
    return next();
  }

  const newOwnerId = uuidv4();
  res.cookie(COOKIE_NAME, newOwnerId, {
    httpOnly: true,
    signed: true,
    secure: config.isProd,
    sameSite: config.isProd ? 'strict' : 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
  });

  req.ownerId = newOwnerId;
  next();
}

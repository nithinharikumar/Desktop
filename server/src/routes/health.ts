import { Router, type Request, type Response } from 'express';
import { checkDbHealth } from '../infra/db.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const dbHealth = await checkDbHealth();

  const responseBody = {
    status: dbHealth.ok ? 'ok' : 'degraded',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealth.ok
        ? { status: 'connected', latencyMs: dbHealth.latencyMs }
        : { status: 'disconnected', error: dbHealth.error },
    },
  };

  if (!dbHealth.ok) {
    res.status(503).json(responseBody);
    return;
  }

  res.status(200).json(responseBody);
});

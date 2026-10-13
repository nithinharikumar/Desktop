import pino from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  transport: !config.isProd
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

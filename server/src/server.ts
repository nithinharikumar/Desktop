import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './infra/logger.js';
import { prisma } from './infra/db.js';

const { app, queue } = createApp();

const server = app.listen(config.env.PORT, async () => {
  logger.info(
    {
      port: config.env.PORT,
      env: config.env.NODE_ENV,
      cors: config.env.CORS_ORIGIN,
    },
    `🚀 Server listening on port ${config.env.PORT}`,
  );

  // Crash recovery on startup: re-enqueue jobs that were left PROCESSING
  try {
    const recovered = await queue.recoverStuckJobs();
    if (recovered > 0) {
      logger.info({ recovered }, 'Successfully recovered stuck jobs on startup');
    }
  } catch (err) {
    logger.error({ err }, 'Error recovering stuck jobs on startup');
  }
});

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    logger.info('HTTP server closed.');

    try {
      if (config.env.DATABASE_URL) {
        await prisma.$disconnect();
        logger.info('Database connection closed.');
      }
    } catch (err) {
      logger.error({ err }, 'Error closing database connection');
    }

    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing process exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

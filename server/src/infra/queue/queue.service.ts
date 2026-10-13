import PQueue from 'p-queue';
import { config } from '../../config/env.js';
import { logger } from '../logger.js';
import type { ImageRepository } from '../../repositories/image.repository.js';

export type JobProcessor = (imageId: string) => Promise<void>;

export interface QueueService {
  enqueue(imageId: string): void;
  recoverStuckJobs(): Promise<number>;
  setProcessor(processor: JobProcessor): void;
  size: number;
  pending: number;
  onIdle(): Promise<void>;
}

export class InProcessQueueService implements QueueService {
  private queue: PQueue;
  private processor: JobProcessor | null = null;
  private maxRetries = 3;

  constructor(
    private repository: ImageRepository,
    concurrency: number = config.thresholds.concurrency,
  ) {
    this.queue = new PQueue({ concurrency });
  }

  get size(): number {
    return this.queue.size;
  }

  get pending(): number {
    return this.queue.pending;
  }

  setProcessor(processor: JobProcessor): void {
    this.processor = processor;
  }

  enqueue(imageId: string): void {
    this.queue.add(() => this.processWithRetry(imageId));
  }

  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  private async processWithRetry(imageId: string, attempt: number = 1): Promise<void> {
    if (!this.processor) {
      logger.info({ imageId }, `[Queue] Job executed without processor: ${imageId}`);
      return;
    }

    try {
      logger.debug({ imageId, attempt }, 'Starting image job execution');
      await this.processor(imageId);
    } catch (err: unknown) {
      logger.error({ err, imageId, attempt }, `System failure executing job for ${imageId}`);

      if (attempt < this.maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 500; // 1s, 2s, 4s
        logger.info({ imageId, nextAttempt: attempt + 1, backoffMs }, 'Scheduling retry with backoff');
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return this.processWithRetry(imageId, attempt + 1);
      }

      // Max retries exhausted - record FAILED status
      logger.error({ imageId }, `Max retries exhausted for ${imageId}. Marking status FAILED`);
      try {
        const stuck = (await this.repository.findStuckProcessing()).find((r) => r.id === imageId);
        if (stuck) {
          await this.repository.update(imageId, stuck.ownerId, {
            status: 'FAILED',
            attempts: attempt,
          });
        }
      } catch (repoErr) {
        logger.error({ repoErr, imageId }, 'Failed to mark image status as FAILED in repository');
      }
    }
  }

  async recoverStuckJobs(): Promise<number> {
    try {
      const stuckJobs = await this.repository.findStuckProcessing();
      if (stuckJobs.length > 0) {
        logger.info({ count: stuckJobs.length }, 'Recovering stuck PROCESSING jobs from previous run');
        for (const job of stuckJobs) {
          this.enqueue(job.id);
        }
      }
      return stuckJobs.length;
    } catch (err) {
      logger.error({ err }, 'Failed to recover stuck jobs on startup');
      return 0;
    }
  }
}

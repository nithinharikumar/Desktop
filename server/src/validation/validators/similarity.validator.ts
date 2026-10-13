import type { Validator, ValidationContext, ValidationResult } from '../types.js';
import type { ImageRepository } from '../../repositories/image.repository.js';
import { computeDHash } from '../../infra/hasher/dhash.js';

export class SimilarityValidator implements Validator {
  name = 'SimilarityValidator';

  constructor(private repository: ImageRepository) {}

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const phash = await computeDHash(ctx.buffer);
    ctx.metrics.phash = phash;

    const isSimilar = await this.repository.findSimilarAccepted(
      ctx.row.ownerId,
      ctx.row.id,
      phash,
      ctx.thresholds.similarityMaxDistance,
    );

    if (isSimilar) {
      return { ok: false, reason: 'DUPLICATE_OR_SIMILAR' };
    }

    return { ok: true };
  }
}

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../infra/db.js';

export type ImageStatus = 'PROCESSING' | 'ACCEPTED' | 'REJECTED' | 'FAILED';

export interface ImageRecord {
  id: string;
  ownerId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: bigint;
  width: number | null;
  height: number | null;
  storageKey: string;
  processedKey: string | null;
  thumbnailKey: string | null;
  status: ImageStatus;
  rejectionReasons: string[];
  phash: string | null;
  blurScore: number | null;
  faceCount: number | null;
  faceAreaRatio: number | null;
  attempts: number;
  createdAt: Date;
  processedAt: Date | null;
}

export interface CreateImageData {
  id?: string;
  ownerId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: bigint;
  storageKey: string;
  status: ImageStatus;
  rejectionReasons?: string[];
}

export interface UpdateImageData {
  status?: ImageStatus;
  rejectionReasons?: string[];
  processedKey?: string | null;
  thumbnailKey?: string | null;
  width?: number | null;
  height?: number | null;
  blurScore?: number | null;
  faceCount?: number | null;
  faceAreaRatio?: number | null;
  phash?: string | null;
  attempts?: number;
  processedAt?: Date | null;
}

export interface FindImagesParams {
  ownerId: string;
  status?: ImageStatus;
  cursor?: string; // base64 encoded { createdAt: string, id: string }
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ImageRepository {
  create(data: CreateImageData): Promise<ImageRecord>;
  findById(id: string, ownerId: string): Promise<ImageRecord | null>;
  findMany(params: FindImagesParams): Promise<PaginatedResult<ImageRecord>>;
  update(id: string, ownerId: string, data: UpdateImageData): Promise<ImageRecord | null>;
  delete(id: string, ownerId: string): Promise<ImageRecord | null>;
  findStuckProcessing(): Promise<ImageRecord[]>;
  findSimilarAccepted(
    ownerId: string,
    currentImageId: string,
    phash: string,
    maxDistance: number,
  ): Promise<boolean>;
  commitValidationResult(
    id: string,
    ownerId: string,
    status: ImageStatus,
    reasons: string[],
    data: UpdateImageData,
    similarityDistanceLimit: number,
  ): Promise<{ status: ImageStatus; reasons: string[] }>;
}

export class PrismaImageRepository implements ImageRepository {
  constructor(private db: PrismaClient = defaultPrisma) {}

  async create(data: CreateImageData): Promise<ImageRecord> {
    const created = await this.db.image.create({
      data: {
        id: data.id,
        ownerId: data.ownerId,
        originalName: data.originalName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        storageKey: data.storageKey,
        status: data.status,
        rejectionReasons: data.rejectionReasons || [],
      },
    });

    return created as unknown as ImageRecord;
  }

  async findById(id: string, ownerId: string): Promise<ImageRecord | null> {
    const img = await this.db.image.findFirst({
      where: { id, ownerId },
    });
    return img ? (img as unknown as ImageRecord) : null;
  }

  async findMany(params: FindImagesParams): Promise<PaginatedResult<ImageRecord>> {
    const limit = Math.min(Math.max(params.limit || 20, 1), 50);
    let cursorData: { createdAt: string; id: string } | null = null;

    if (params.cursor) {
      try {
        cursorData = JSON.parse(Buffer.from(params.cursor, 'base64').toString('utf-8'));
      } catch {
        cursorData = null;
      }
    }

    const where: any = { ownerId: params.ownerId };
    if (params.status) {
      where.status = params.status;
    }

    if (cursorData) {
      where.OR = [
        { createdAt: { lt: new Date(cursorData.createdAt) } },
        {
          createdAt: new Date(cursorData.createdAt),
          id: { lt: cursorData.id },
        },
      ];
    }

    const items = await this.db.image.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNext = items.length > limit;
    const returnItems = hasNext ? items.slice(0, limit) : items;

    let nextCursor: string | null = null;
    if (hasNext && returnItems.length > 0) {
      const lastItem = returnItems[returnItems.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          createdAt: lastItem.createdAt.toISOString(),
          id: lastItem.id,
        }),
      ).toString('base64');
    }

    return {
      items: returnItems as unknown as ImageRecord[],
      nextCursor,
    };
  }

  async update(id: string, _ownerId: string, data: UpdateImageData): Promise<ImageRecord | null> {
    const updated = await this.db.image.update({
      where: { id },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.rejectionReasons && { rejectionReasons: data.rejectionReasons }),
        ...(data.processedKey !== undefined && { processedKey: data.processedKey }),
        ...(data.thumbnailKey !== undefined && { thumbnailKey: data.thumbnailKey }),
        ...(data.width !== undefined && { width: data.width }),
        ...(data.height !== undefined && { height: data.height }),
        ...(data.blurScore !== undefined && { blurScore: data.blurScore }),
        ...(data.faceCount !== undefined && { faceCount: data.faceCount }),
        ...(data.faceAreaRatio !== undefined && { faceAreaRatio: data.faceAreaRatio }),
        ...(data.attempts !== undefined && { attempts: data.attempts }),
        ...(data.processedAt !== undefined && { processedAt: data.processedAt }),
      },
    });

    return updated as unknown as ImageRecord;
  }

  async delete(id: string, ownerId: string): Promise<ImageRecord | null> {
    const existing = await this.findById(id, ownerId);
    if (!existing) return null;

    await this.db.image.delete({
      where: { id },
    });

    return existing;
  }

  async findStuckProcessing(): Promise<ImageRecord[]> {
    const items = await this.db.image.findMany({
      where: { status: 'PROCESSING' },
    });
    return items as unknown as ImageRecord[];
  }

  async findSimilarAccepted(
    ownerId: string,
    currentImageId: string,
    phash: string,
    maxDistance: number,
  ): Promise<boolean> {
    const result: any[] = await this.db.$queryRaw`
      SELECT id FROM "images"
      WHERE "ownerId" = ${ownerId}
        AND "status" = 'ACCEPTED'
        AND "id" != ${currentImageId}::uuid
        AND "phash" IS NOT NULL
        AND bit_count("phash" # ${phash}::bit(64)) <= ${maxDistance}
      LIMIT 1
    `;
    return result.length > 0;
  }

  async commitValidationResult(
    id: string,
    ownerId: string,
    status: ImageStatus,
    reasons: string[],
    data: UpdateImageData,
    similarityDistanceLimit: number,
  ): Promise<{ status: ImageStatus; reasons: string[] }> {
    return await this.db.$transaction(async (tx: any) => {
      // Hold advisory xact lock per owner to serialize similarity checks and status commits
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`;

      let finalStatus = status;
      const finalReasons = [...reasons];

      if (finalStatus === 'ACCEPTED' && data.phash) {
        const matches: any[] = await tx.$queryRaw`
          SELECT id FROM "images"
          WHERE "ownerId" = ${ownerId}
            AND "status" = 'ACCEPTED'
            AND "id" != ${id}::uuid
            AND "phash" IS NOT NULL
            AND bit_count("phash" # ${data.phash}::bit(64)) <= ${similarityDistanceLimit}
          LIMIT 1
        `;

        if (matches.length > 0) {
          finalStatus = 'REJECTED';
          if (!finalReasons.includes('DUPLICATE_OR_SIMILAR')) {
            finalReasons.push('DUPLICATE_OR_SIMILAR');
          }
        }
      }

      await tx.image.update({
        where: { id },
        data: {
          status: finalStatus,
          rejectionReasons: finalReasons,
          processedKey: data.processedKey,
          thumbnailKey: data.thumbnailKey,
          width: data.width,
          height: data.height,
          blurScore: data.blurScore,
          faceCount: data.faceCount,
          faceAreaRatio: data.faceAreaRatio,
          processedAt: new Date(),
        },
      });

      if (data.phash) {
        await tx.$executeRaw`
          UPDATE "images" SET "phash" = ${data.phash}::bit(64) WHERE "id" = ${id}::uuid
        `;
      }

      return { status: finalStatus, reasons: finalReasons };
    });
  }
}

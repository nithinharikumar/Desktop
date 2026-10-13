import type {
  ImageRepository,
  ImageRecord,
  CreateImageData,
  UpdateImageData,
  FindImagesParams,
  PaginatedResult,
  ImageStatus,
} from './image.repository.js';

export class InMemoryImageRepository implements ImageRepository {
  private records: Map<string, ImageRecord> = new Map();

  async create(data: CreateImageData): Promise<ImageRecord> {
    const id = data.id || crypto.randomUUID();
    const record: ImageRecord = {
      id,
      ownerId: data.ownerId,
      originalName: data.originalName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      width: null,
      height: null,
      storageKey: data.storageKey,
      processedKey: null,
      thumbnailKey: null,
      status: data.status,
      rejectionReasons: data.rejectionReasons || [],
      phash: null,
      blurScore: null,
      faceCount: null,
      faceAreaRatio: null,
      attempts: 0,
      createdAt: new Date(),
      processedAt: null,
    };
    this.records.set(id, record);
    return { ...record };
  }

  async findById(id: string, ownerId: string): Promise<ImageRecord | null> {
    const record = this.records.get(id);
    if (!record || record.ownerId !== ownerId) return null;
    return { ...record };
  }

  async findMany(params: FindImagesParams): Promise<PaginatedResult<ImageRecord>> {
    const limit = Math.min(Math.max(params.limit || 20, 1), 50);
    let items = Array.from(this.records.values()).filter((r) => r.ownerId === params.ownerId);

    if (params.status) {
      items = items.filter((r) => r.status === params.status);
    }

    items.sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });

    if (params.cursor) {
      try {
        const cursorData = JSON.parse(Buffer.from(params.cursor, 'base64').toString('utf-8'));
        const cursorDate = new Date(cursorData.createdAt).getTime();
        items = items.filter((r) => {
          const t = r.createdAt.getTime();
          return t < cursorDate || (t === cursorDate && r.id < cursorData.id);
        });
      } catch {
        // ignore invalid cursor
      }
    }

    const hasNext = items.length > limit;
    const returnItems = hasNext ? items.slice(0, limit) : items;

    let nextCursor: string | null = null;
    if (hasNext && returnItems.length > 0) {
      const last = returnItems[returnItems.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        }),
      ).toString('base64');
    }

    return {
      items: returnItems.map((r) => ({ ...r })),
      nextCursor,
    };
  }

  async update(id: string, ownerId: string, data: UpdateImageData): Promise<ImageRecord | null> {
    const existing = await this.findById(id, ownerId);
    if (!existing) return null;

    const updated: ImageRecord = {
      ...existing,
      ...(data.status && { status: data.status }),
      ...(data.rejectionReasons && { rejectionReasons: data.rejectionReasons }),
      ...(data.processedKey !== undefined && { processedKey: data.processedKey }),
      ...(data.thumbnailKey !== undefined && { thumbnailKey: data.thumbnailKey }),
      ...(data.width !== undefined && { width: data.width }),
      ...(data.height !== undefined && { height: data.height }),
      ...(data.blurScore !== undefined && { blurScore: data.blurScore }),
      ...(data.faceCount !== undefined && { faceCount: data.faceCount }),
      ...(data.faceAreaRatio !== undefined && { faceAreaRatio: data.faceAreaRatio }),
      ...(data.phash !== undefined && { phash: data.phash }),
      ...(data.attempts !== undefined && { attempts: data.attempts }),
      ...(data.processedAt !== undefined && { processedAt: data.processedAt }),
    };

    this.records.set(id, updated);
    return { ...updated };
  }

  async delete(id: string, ownerId: string): Promise<ImageRecord | null> {
    const existing = await this.findById(id, ownerId);
    if (!existing) return null;
    this.records.delete(id);
    return existing;
  }

  async findStuckProcessing(): Promise<ImageRecord[]> {
    return Array.from(this.records.values())
      .filter((r) => r.status === 'PROCESSING')
      .map((r) => ({ ...r }));
  }

  private hammingDistance(a: string, b: string): number {
    let diff = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) diff++;
    }
    return diff + Math.abs(a.length - b.length);
  }

  async findSimilarAccepted(
    ownerId: string,
    currentImageId: string,
    phash: string,
    maxDistance: number,
  ): Promise<boolean> {
    const accepted = Array.from(this.records.values()).filter(
      (r) => r.ownerId === ownerId && r.status === 'ACCEPTED' && r.id !== currentImageId && r.phash,
    );

    for (const img of accepted) {
      if (this.hammingDistance(img.phash!, phash) <= maxDistance) {
        return true;
      }
    }
    return false;
  }

  async commitValidationResult(
    id: string,
    ownerId: string,
    status: ImageStatus,
    reasons: string[],
    data: UpdateImageData,
    similarityDistanceLimit: number,
  ): Promise<{ status: ImageStatus; reasons: string[] }> {
    let finalStatus = status;
    const finalReasons = [...reasons];

    if (finalStatus === 'ACCEPTED' && data.phash) {
      const isSimilar = await this.findSimilarAccepted(
        ownerId,
        id,
        data.phash,
        similarityDistanceLimit,
      );
      if (isSimilar) {
        finalStatus = 'REJECTED';
        if (!finalReasons.includes('DUPLICATE_OR_SIMILAR')) {
          finalReasons.push('DUPLICATE_OR_SIMILAR');
        }
      }
    }

    await this.update(id, ownerId, {
      ...data,
      status: finalStatus,
      rejectionReasons: finalReasons,
      processedAt: new Date(),
    });

    return { status: finalStatus, reasons: finalReasons };
  }
}

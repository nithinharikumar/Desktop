-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('PROCESSING', 'ACCEPTED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "images" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "storageKey" TEXT NOT NULL,
    "processedKey" TEXT,
    "thumbnailKey" TEXT,
    "status" "ImageStatus" NOT NULL DEFAULT 'PROCESSING',
    "rejectionReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "phash" bit(64),
    "blurScore" DOUBLE PRECISION,
    "faceCount" INTEGER,
    "faceAreaRatio" DOUBLE PRECISION,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- Create composite index on (ownerId, status, createdAt DESC)
CREATE INDEX "images_ownerId_status_createdAt_idx" ON "images"("ownerId", "status", "createdAt" DESC);

-- Create partial index on (ownerId) WHERE status='ACCEPTED'
CREATE INDEX "images_ownerId_accepted_idx" ON "images"("ownerId") WHERE "status" = 'ACCEPTED';

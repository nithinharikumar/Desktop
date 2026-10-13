# Image Gatekeeper (Photo Quality Pipeline)

A high-performance photo upload quality gatekeeper designed to validate and filter selfie batches before AI model training or headshot generation.

See [TECH_STACK.md](./TECH_STACK.md) for a comprehensive breakdown of technologies used and architectural justifications.

---

## 🏛️ Architecture Overview

```text
+-----------------------------------------------------------------------------------------+
|                                    MODULAR MONOLITH                                     |
|                                                                                         |
|  +--------------------+        +---------------------+        +----------------------+  |
|  |   CLIENT (React)   | -----> |     HTTP / API      | -----> |   Image Repository   |  |
|  | - Drag & drop      | (XHR)  | - Magic-byte check  |        | - Cursor pagination  |  |
|  | - Pre-validation   |        | - Signed cookies    |        | - PostgreSQL (Prisma)|  |
|  | - Polling / State  | <----- | - HMAC File Server  |        | - In-memory fallback |  |
|  +--------------------+ (GET)  +----------+----------+        +----------+-----------+  |
|                                           |                              |              |
|                                           v                              |              |
|                                +---------------------+                   |              |
|                                |   In-Process Queue  |                   |              |
|                                |   (p-queue, c=3)    |                   |              |
|                                +----------+----------+                   |              |
|                                           |                              |              |
|                                           v                              |              |
|                          +---------------------------------+             |              |
|                          |    Validation Pipeline Engine   |             |              |
|                          | - FormatValidator (magic bytes) |             |              |
|                          | - FileSizeValidator (min 50KB)  |             |              |
|                          | - ResolutionValidator (640x640) |             |              |
|                          | - BlurValidator (Laplacian var) |             |              |
|                          | - FaceCount & FaceSize (models) |             |              |
|                          | - SimilarityValidator (dHash64) |             |              |
|                          +----------------+----------------+             |              |
|                                           |                              |              |
|                                           v                              |              |
|                       +---------------------------------------+          |              |
|                       | Atomic Commit & Advisory Lock         | <--------+              |
|                       | pg_advisory_xact_lock(ownerId)        |                         |
|                       | bit_count(phash # candidate) <= 5     |                         |
|                       +-------------------+-------------------+                         |
|                                           |                                             |
|                                           v                                             |
|                       +---------------------------------------+                         |
|                       | Post-Processing & Storage             |                         |
|                       | - Strip EXIF / Rotate                 |                         |
|                       | - Processed JPEG (q90)                |                         |
|                       | - 400px Thumbnails                    |                         |
|                       +---------------------------------------+                         |
+-----------------------------------------------------------------------------------------+
```

---

## 🚀 Setup in 5 Steps

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Configure environment**:
   ```bash
   cp server/.env.example server/.env
   # Add your Neon/Supabase DATABASE_URL (or leave empty to run in-memory)
   ```
3. **Generate Prisma client & run migrations**:
   ```bash
   npm --prefix server run prisma:generate
   npm --prefix server run prisma:migrate
   ```
4. **Build both workspaces**:
   ```bash
   npm run build
   ```
5. **Start dev server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` (client dev with API proxy) or `http://localhost:3000` (production monolith).

---

## 📊 Quality Thresholds & Rationale

| Parameter | Default | Env Var | Rationale |
|-----------|---------|---------|-----------|
| `minFileBytes` | `51,200` (50 KB) | `MIN_FILE_BYTES` | Rejects heavily compressed, artifact-laden images unsuited for fine-tuning. |
| `minWidth` | `640 px` | `MIN_WIDTH` | Ensures sufficient pixel density for high-resolution AI face generation. |
| `minHeight` | `640 px` | `MIN_HEIGHT` | Ensures balanced dimensions without extreme cropping. |
| `blurThreshold` | `100.0` | `BLUR_THRESHOLD` | Evaluates variance of Laplacian convolution; rejects motion blur and camera defocus. |
| `minFaceAreaRatio` | `0.05` (5%) | `MIN_FACE_AREA_RATIO` | Ensures face is prominent in the frame, rejecting distant full-body background shots. |
| `similarityMaxDistance`| `5 bits` | `SIMILARITY_MAX_DISTANCE` | 64-bit dHash Hamming threshold. Flags near-duplicates while allowing distinct angles. |
| `maxUploadBytes` | `15,728,640` (15 MB)| `MAX_UPLOAD_BYTES` | Prevents Denial-of-Service while supporting raw smartphone camera photos. |
| `concurrency` | `3` | `CONCURRENCY` | Balances CPU core utilization across heavy Sharp/ML workloads without OOM. |

---

## 📡 API Specification

All responses return standard `{ error: { code, message } }` on failure and never leak stack traces.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/images` | Upload multipart batch (field `files`, max 20). Sniffs magic bytes, creates records, returns HTTP 201. |
| `GET` | `/api/images?status=&cursor=&limit=` | Cursor-paginated listing on `(createdAt, id)` scoped to owner session cookie. Returns signed URLs. |
| `GET` | `/api/images/:id` | Fetch single image details and status metrics. |
| `DELETE`| `/api/images/:id` | Deletes image record and all corresponding raw, processed, and thumbnail storage files. |
| `POST` | `/api/images/:id/retry` | Re-enqueues a `FAILED` image for retry. Returns HTTP 400 if image is not in `FAILED` state. |
| `GET` | `/api/files/*?expires=&sig=` | Secure file retrieval verified with HMAC SHA-256 signature and expiry timestamp. |
| `GET` | `/health` | Health check reporting service uptime and live database connectivity status. |

---

## ⚖️ Tradeoffs & Design Decisions

1. **In-Process Queue vs. SQS / pg-boss**:
   - *Chosen*: In-process `p-queue` with crash-recovery on startup (`recoverStuckJobs`).
   - *Why*: Meets the strict zero-Docker, zero-external-infrastructure constraint while providing immediate concurrency control and backpressure.
2. **Server-Proxied Upload vs. Presigned Direct-to-S3**:
   - *Chosen*: Multipart streaming through Express with magic-byte sniffing before storage.
   - *Why*: Allows instant rejection of invalid file types without storing junk or incurring upload bandwidth and storage costs.
3. **Local Face Model vs. AWS Rekognition**:
   - *Chosen*: `@vladmandic/face-api` (wasm/tfjs tensor feed via Sharp RGB pixels, zero canvas dependency) behind a polymorphic `FaceDetector` interface.
   - *Why*: Zero cloud billing dependency, privacy-preserving, and completely offline-capable.
4. **Polling vs. Server-Sent Events (SSE)**:
   - *Chosen*: Adaptive 1.5s polling while items are in-flight.
   - *Why*: Simple, resilient to proxy disconnects, stateless, and self-healing.
5. **Heuristic Thresholds**:
   - *Chosen*: Laplacian kernel variance and 64-bit difference hashing (dHash).
   - *Why*: Deterministic, blazingly fast (under 10ms per image), and zero GPU requirements.

---

## 🔮 What I'd Do Next At Scale

1. **Presigned Direct-to-Object-Storage Uploads**: Offload multi-gigabyte batch uploads directly to S3 / Cloudflare R2 via presigned PUT URLs, using S3 Object Lambda or EventBridge for asynchronous validation triggers.
2. **Distributed Queue (BullMQ / AWS SQS)**: Decouple background compute into autoscaled worker pools on AWS ECS Fargate or Kubernetes.
3. **Vector Similarity (pgvector / Milvus)**: Replace Hamming distance on 64-bit dHash with deep facial embeddings (FaceNet / CLIP) stored in `pgvector` for pose-invariant duplicate detection.
4. **Edge CDN Distribution**: Cloudflare Workers / CloudFront with signed cookies for high-throughput thumbnail delivery.
5. **ClamAV Antivirus Scanner**: Stream incoming image buffers through a virus scanning daemon before writing to permanent storage.

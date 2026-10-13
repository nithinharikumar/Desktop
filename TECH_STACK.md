# Image Gatekeeper: Technology Stack & Architectural Rationale

This document details every technology, library, framework, algorithm, and architectural pattern utilized across the **Image Gatekeeper** codebase, along with the concrete engineering reasons, trade-offs, and design justifications for why they were chosen.

---

## 🎯 Executive Summary & Purpose

The **Image Gatekeeper** is an automated quality assurance pipeline designed to validate, filter, and normalize batches of selfie photos before they are fed into AI model fine-tuning (e.g., LoRA, DreamBooth, Flux, or Stable Diffusion headshot generation).

In AI model training, **"Garbage In, Garbage Out"** is the fundamental constraint:
- Blurry images degrade latent weights and introduce fuzziness into generated outputs.
- Low-resolution photos produce blurry or low-frequency facial artifacts.
- Multiple faces confuse subject-token associations.
- Distant faces fail to capture fine-grained facial landmarks (eyes, nose, skin texture).
- Duplicate and near-duplicate photos cause model overfitting on a single angle or lighting condition.

Image Gatekeeper intercepts uploads, applies a multi-stage validation pipeline, strips dangerous EXIF metadata, generates optimized thumbnails, and provides immediate real-time feedback to users.

---

## 🏛️ Architectural Choice: Modular Monolith

### Why a Modular Monolith?
Instead of an over-engineered distributed microservice cluster (separate upload service, thumbnail worker, ML worker, database service, API gateway):
- **Zero Network Serialization Overhead**: In-memory buffers flow directly between validation stages (Sharp -> Face API -> dHash) without intermediate S3 writes or inter-service HTTP/gRPC hops.
- **Single Process Deployment**: Runs seamlessly on local machines, single VPS instances (Render, Railway, Fly.io, DigitalOcean), or containerized environments with zero mandatory cloud dependencies.
- **Clean Internal Boundaries**: Divided into strict domains (`routes/`, `middlewares/`, `services/`, `validators/`, `repositories/`, `storage/`, `infra/`), allowing any individual component to be factored out into an external worker if scale demands it in the future.

---

## 🛠️ Comprehensive Technology Breakdown

### 1. Language & Runtimes

| Technology | Purpose | Why It Was Chosen | Alternatives Considered & Rejected |
| :--- | :--- | :--- | :--- |
| **Node.js (v20+ LTS)** | Backend runtime | Non-blocking asynchronous I/O excels at handling concurrent multipart uploads, streaming file buffers, and polling APIs. Long-term stability and unified JS/TS ecosystem across client and server. | Python (FastAPI/Flask) - would split language stack, complicating fullstack sharing; Go - smaller computer vision / TFJS ecosystem. |
| **TypeScript (v5.4)** | Type system | Enforces strict compile-time types across domain models (`ImageItem`, `ValidationResult`, `QualityMetrics`), API contracts, and upload states. Prevents runtime state bugs during multi-stage processing. | Plain JavaScript - too prone to silent property undefined errors during pipeline stages. |
| **Native ES Modules (`"type": "module"`)** | Module system | Standards-compliant module loading across both client and server. Avoids legacy CommonJS bundler quirks and aligns with modern libraries (`file-type`, `p-queue`, `@vladmandic/face-api`). | CommonJS (CJS) - legacy, creates interoperability friction with modern ESM-only packages. |

---

### 2. Backend Framework & HTTP Pipeline

| Technology | Purpose | Why It Was Chosen | Alternatives Considered & Rejected |
| :--- | :--- | :--- | :--- |
| **Express.js (v4.19)** | HTTP web server | Battle-tested, minimalist HTTP server with the most mature ecosystem of security, parsing, and streaming middlewares in the Node ecosystem. Low memory footprint and predictable execution pipeline. | Fastify (higher raw synthetic throughput, but smaller middleware compatibility surface); NestJS (excessive boilerplate and decorator complexity for a focused pipeline). |
| **Multer (v1.4.5)** | Multipart form parser | Handles streaming multi-file uploads (`POST /api/images` with up to 20 files per batch). Configured with in-memory buffer storage to feed raw bytes directly into the magic-byte sniffer without temporary disk writes. | Formidable / Busboy - Multer provides the cleanest Express integration and standard file abstraction. |
| **file-type (v19)** | Magic-byte format sniffer | Inspects actual binary header bytes (`FF D8 FF` for JPEG, `89 50 4E 47` for PNG, etc.) rather than trusting user-provided file extensions or client-sent `Content-Type` headers, preventing extension-spoofing attacks. | Trusting `req.file.mimetype` - insecure; clients can easily spoof headers to disguise malicious files. |
| **heic-convert (v2.1)** | Apple HEIC/HEIF decoder | Apple iPhones save photos by default in proprietary HEIC format. `heic-convert` automatically transforms these into standardized JPEG buffers before pipeline validation without failing mobile uploads. | Rejecting HEIC outright - ruins user experience for iPhone camera users. |

---

### 3. Image Processing & Computer Vision

| Technology | Purpose | Why It Was Chosen | Alternatives Considered & Rejected |
| :--- | :--- | :--- | :--- |
| **Sharp (v0.33, libvips)** | Core image manipulation | SIMD-accelerated C++ library that processes images **4x to 8x faster than ImageMagick or GraphicsMagick**. Handles EXIF stripping, auto-orientation, 400px thumbnail generation, q90 JPEG compression, and raw grayscale buffer extraction. | `jimp` (pure JS, 10x slower, memory-heavy); `canvas` / `node-canvas` (requires complex system Cairo dependencies, prone to memory leaks). |
| **Laplacian Convolution Kernel** | Blur detection | Custom 3x3 convolution kernel `[[0, 1, 0], [1, -4, 1], [0, 1, 0]]` applied via Sharp to calculate the spatial 2nd derivative (rate of intensity change) followed by variance evaluation. Executes in **< 10ms per photo** without requiring heavy neural networks or GPUs. | Deep learning blur classifiers (too slow, GPU required, high latency); FFT (Fast Fourier Transform - heavier CPU overhead than spatial Laplacian). |
| **Difference Hashing (dHash 64-bit)** | Perceptual duplicate detection | Resizes image to 9x8 grayscale and computes adjacent pixel brightness gradients to produce a 64-bit integer hash. Invariant to compression, minor lighting, and scaling. Enables instant bitwise Hamming distance comparisons (`bit_count(hashA ^ hashB) <= 5`). | pHash (DCT-based, slower calculation); MD5/SHA256 (cryptographic hashes fail if even a single byte or pixel metadata changes). |
| **@vladmandic/face-api (v1.7)** | Local face detection | Runs TinyFaceDetector (quantized TensorFlow.js with WebAssembly backend) entirely locally on CPU. Configured to accept raw RGB pixel tensors directly from Sharp, eliminating the need for `node-canvas` or native browser window dependencies. | AWS Rekognition / Google Cloud Vision (requires paid cloud account, introduces network latency, violates strict user privacy); OpenCV C++ bindings (brittle system installations). |

---

### 4. Concurrency & Queue Engine

| Technology | Purpose | Why It Was Chosen | Alternatives Considered & Rejected |
| :--- | :--- | :--- | :--- |
| **p-queue (v8.0)** | In-process concurrency control | Constrains concurrent heavy image processing jobs (default `concurrency: 3`). Prevents CPU saturation and Node.js process out-of-memory (OOM) crashes when many images are uploaded at once. | Unbounded `Promise.all` (crashes server when 20+ images are submitted); BullMQ / Redis (violates the zero-external-infrastructure / zero-Docker requirement). |
| **Crash Recovery Routine (`recoverStuckJobs`)** | Job fault tolerance | On server boot, queries the repository for any records stuck in `PROCESSING` status (from a previous unexpected shutdown or crash) and automatically re-enqueues them into `p-queue`. | Manual cleanup or lost jobs. |

---

### 5. Persistence, Database & Transactions

| Technology | Purpose | Why It Was Chosen | Alternatives Considered & Rejected |
| :--- | :--- | :--- | :--- |
| **Prisma ORM (v5.14)** | Database abstraction & migrations | Generates fully type-safe database clients, manages migrations, and provides declarative schema definitions (`Image` model with BigInt phash, enum statuses, JSON failure reasons). | Raw SQL (lacks automatic type generation); TypeORM (more verbose and error-prone migrations). |
| **Polymorphic Repository Pattern** | Zero-config database flexibility | Interfaces `IImageRepository` implemented by both `PrismaImageRepository` (for PostgreSQL like Neon/Supabase) and `InMemoryImageRepository` (for zero-setup dev/demo mode). The app detects if `DATABASE_URL` is set and selects the appropriate provider automatically. | Hard-requiring a live PostgreSQL server, blocking instant local setup. |
| **PostgreSQL Advisory Locks (`pg_advisory_xact_lock`)** | Race-condition prevention | Serializes duplicate-detection validation per user session (`ownerId`). Guarantees that if two identical photos are uploaded in the same concurrent batch, one is committed first, allowing the second to correctly detect the near-duplicate. | Optimistic concurrency (fails after the expensive validation has already run); Table-level locks (kills global throughput). |

---

### 6. Security, Integrity & Privacy

| Technology | Purpose | Why It Was Chosen | Alternatives Considered & Rejected |
| :--- | :--- | :--- | :--- |
| **HMAC-SHA256 File Signatures** | Secure thumbnail/raw file delivery | Files are served via `/api/files/*?expires=...&sig=...` verified using cryptographic HMAC SHA-256 signatures. Prevents Insecure Direct Object References (IDOR) and unauthorized enumeration of other users' photos. | Public `/uploads` static folder (completely unprotected); OAuth/JWT per image view (breaks standard `<img src="..." />` tags). |
| **Signed Session Cookies (`cookie-parser`)** | Anonymous owner scoping | Assigns a signed UUID `ownerId` cookie on the user's first request. Allows cursor pagination, uploads, and deletions to remain strictly scoped to the user without forcing them to register or log in. | Mandatory auth wall (adds high user drop-off); LocalStorage token (more susceptible to XSS). |
| **Helmet (v7.1)** | HTTP security headers | Sets HTTP response headers (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`) protecting against clickjacking, MIME-sniffing, and cross-site attacks. | Manual header configuration (prone to omissions). |
| **express-rate-limit (v7.2)** | DoS & abuse prevention | Limits upload endpoint requests per IP address, preventing volumetric Denial-of-Service attacks and API flooding. | Unthrottled endpoints. |
| **EXIF Metadata Stripping** | Privacy & location safety | Sharp pipeline automatically strips GPS coordinates, camera serial numbers, and device fingerprints from accepted images before storage. | Leaving raw metadata intact (leaks user private home/location data). |

---

### 7. Frontend Architecture & UI

| Technology | Purpose | Why It Was Chosen | Alternatives Considered & Rejected |
| :--- | :--- | :--- | :--- |
| **React 18** | UI framework | Declarative component hierarchy, fast virtual DOM reconciliation for real-time progress bars, image cards, and stats updates. | Vanilla JavaScript (difficult to manage complex upload state across multiple cards); Angular/Vue (heavier boilerplate). |
| **Vite (v5.2)** | Build tool & dev server | Lightning-fast development server with instant Hot Module Replacement (HMR) powered by native ES modules. Production bundle optimization with Rollup. | Webpack / Create React App (slow builds, outdated tooling). |
| **useReducer State Machine** | Deterministic state management | `uploadReducer` manages state transitions (`STAGE_FILES`, `UPLOAD_PROGRESS`, `UPLOAD_SUCCESS`, `UPDATE_ITEMS`, `REMOVE_ITEM`, `RETRY_ITEM`) without race conditions from parallel uploads and polling updates. | Multiple disconnected `useState` hooks (causes desynchronization and tearing). |
| **Adaptive Polling Hook (`usePollImages`)** | Background status synchronization | Automatically queries `/api/images` at 1.5-second intervals only when active items are in `PROCESSING` or `UPLOADING` status, immediately stopping when all items are terminal. | Persistent WebSockets / SSE (requires sticky sessions and complex reverse proxy connection management for simple short-lived batch jobs). |
| **Lucide React** | Icons | Crisp, accessible, tree-shakeable SVG icons for upload states, retry triggers, status badges, and quality breakdown tooltips. | Font Awesome / Material Icons (huge CSS and webfont bundle size). |
| **Vanilla CSS with Glassmorphism & Design Tokens** | Styling | Fast, zero-runtime CSS variables (`--bg-primary`, `--surface-card`, `--accent-primary`, `--danger`, `--success`) with responsive CSS Grid layouts, backdrop filters, and subtle micro-animations. | Tailwind CSS (adds build dependencies and verbose HTML classes); CSS-in-JS (runtime styling penalty). |

---

### 8. Validation, Logging & Developer Experience

| Technology | Purpose | Why It Was Chosen | Alternatives Considered & Rejected |
| :--- | :--- | :--- | :--- |
| **Zod (v3.23)** | Schema validation | Validates environment variables (`PORT`, `DATABASE_URL`, `BLUR_THRESHOLD`, `CONCURRENCY`) and query parameters (`status`, `cursor`, `limit`). Fails fast at startup with descriptive error messages if config is invalid. | Joi / manual `if (!process.env...)` checks (lacks automatic TypeScript type inference). |
| **Pino & Pino-HTTP (v9)** | Structured JSON logging | High-speed structured logger with negligible latency overhead. Supports log levels, request correlation IDs, and human-readable formatting in development (`pino-pretty`). | `console.log` (blocks event loop on heavy output, unstructured); Winston (significantly slower throughput than Pino). |
| **Vitest (v1.6)** | Unit & integration testing | Uses the same transform pipeline as Vite, enabling sub-second test execution for both server pipeline logic and client reducers. | Jest (requires separate Babel/ts-jest configurations and has slower startup times). |
| **TSX (TypeScript Execute)** | Development execution | Runs TypeScript server code directly in development with file-watching (`tsx watch src/server.ts`) without requiring manual pre-compilation steps. | `ts-node` (slower, complex ESM loader configuration); `nodemon` (requires external build step). |

---

## 🔬 Algorithmic Deep Dive

### 1. Spatial Laplacian Blur Variance
Blur is quantified as the variance of the 2D Laplacian operator applied across pixel intensities:
$$\nabla^2 I = \frac{\partial^2 I}{\partial x^2} + \frac{\partial^2 I}{\partial y^2}$$

In discrete space, this is evaluated using the 3x3 convolution matrix:
$$K = \begin{bmatrix} 0 & 1 & 0 \\ 1 & -4 & 1 \\ 0 & 1 & 0 \end{bmatrix}$$

- **High Variance ($> 100$)**: Sharp edges, crisp eyelashes, hair strands, and iris boundaries.
- **Low Variance ($< 100$)**: Smooth gradients, motion blur, or camera out-of-focus.

### 2. 64-Bit Difference Hashing (dHash)
1. Resize image to $9 \times 8$ grayscale ($72$ pixels).
2. For each row ($8$ rows of $9$ pixels), compare adjacent pixels: $P[x] > P[x+1]$.
3. Yields $8 \times 8 = 64$ boolean bits stored as a 64-bit integer (`BigInt`).
4. Two images $A$ and $B$ are duplicates if their Hamming distance is within the threshold:
$$\text{dist}(A, B) = \text{popcount}(A \oplus B) \le 5$$

---

## 📊 Summary Matrix

| Category | Primary Technology | Core Benefit |
| :--- | :--- | :--- |
| **Architecture** | Modular Monolith | High performance, zero Docker/microservice overhead, clean decoupled modules |
| **Image Processing** | Sharp (libvips) | 4-8x faster than alternatives, low memory, SIMD accelerated |
| **Face Analysis** | `@vladmandic/face-api` (WASM/TFJS) | 100% offline, privacy-first, zero cloud billing, no canvas dependencies |
| **Concurrency** | `p-queue` | Concurrency limit = 3, protects CPU and prevents OOM crashes |
| **Database** | Prisma + Dual Repository | Type-safe PostgreSQL with automatic in-memory fallback |
| **Security** | Magic bytes + HMAC-SHA256 URLs | Prevents file spoofing, IDOR, and unauthorized photo access |
| **Frontend** | React 18 + Vite + Reducer | Instant HMR, deterministic upload queue, responsive glassmorphism UI |

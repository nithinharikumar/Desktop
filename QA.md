# Quality Gatekeeper QA Manual Checklist

Use this manual verification checklist to test all edge cases and validation rules of the Photo Gatekeeper modular monolith.

| # | Test Scenario | Steps to Execute | Expected Behavior |
|---|---------------|------------------|-------------------|
| 1 | **Valid JPEG / PNG** | Upload a crisp >640x640 selfie photo with 1 face | Lands in **ACCEPTED** section. Shows dimensions, face count, and sharpness badge. |
| 2 | **Valid HEIC Upload** | Upload an iPhone `.heic` photo | Lands in **ACCEPTED** section. Normalized to JPEG on server; thumbnail renders properly. |
| 3 | **Blocked Client-Side (GIF / PDF)** | Attempt to drag or select a `.gif` or `.pdf` file | Rejected immediately client-side (**CLIENT_REJECTED**). Shows inline error and never initiates network upload. |
| 4 | **Spoofed Extension (.exe as .jpg)** | Rename an executable or text file to `malicious.jpg` and upload | Passes client extension filter; server sniffs magic bytes with `file-type`, detects non-image, and marks **REJECTED** (`INVALID_FORMAT`) without storage upload. |
| 5 | **Tiny File (< 50KB)** | Upload an image file under 51,200 bytes | Rejected by `FileSizeValidator` (`FILE_TOO_SMALL`). |
| 6 | **Low Resolution (< 640x640)** | Upload a 300x300 pixel photo | Rejected by `ResolutionValidator` (`RESOLUTION_TOO_LOW`). |
| 7 | **Motion Blurred / Out of Focus** | Upload a blurry photo (Laplacian variance < 100) | Rejected by `BlurValidator` (`IMAGE_BLURRY`). Displays calculated sharpness score. |
| 8 | **Group Photo (> 1 Face)** | Upload a photo with 2 or more people | Rejected by `FaceCountValidator` (`MULTIPLE_FACES`). Copy: "More than one face detected." |
| 9 | **Tiny Face (< 5% frame)** | Upload a full-body landscape photo where face is small | Rejected by `FaceSizeValidator` (`FACE_TOO_SMALL`). Copy: "Face is too far away." |
| 10 | **No Face Detected** | Upload an object, animal, or landscape photo without human face | Rejected by `FaceCountValidator` (`NO_FACE_DETECTED`). Copy: "No face detected." |
| 11 | **Exact Duplicate** | Upload the same accepted photo twice | First image is **ACCEPTED**. Second image is flagged as `DUPLICATE_OR_SIMILAR` and **REJECTED**. |
| 12 | **Resized Duplicate** | Upload a photo, then upload a downscaled copy of the same photo | 64-bit dHash Hamming distance <= 5 detects similarity and rejects the second image (`DUPLICATE_OR_SIMILAR`). |
| 13 | **Concurrent Near-Duplicates** | Upload two near-identical images in the same batch simultaneously | Both jobs run in parallel; `pg_advisory_xact_lock` serializes commit so **exactly one** is ACCEPTED and one is REJECTED. |
| 14 | **Maximum Batch Limit (20 files)** | Drag 20 valid photos at once | All 20 photos upload in a single multipart request, processed with concurrency 3 via `p-queue`. |
| 15 | **Network Interruption Mid-Upload** | Disconnect network or cancel during progress bar | Card status transitions to **FAILED** with an actionable **Retry** button. |
| 16 | **Page Refresh (Hydration)** | Refresh browser while photos are in Accepted/Rejected sections | State automatically hydrates from `GET /api/images` using the signed session cookie. |
| 17 | **Corrupt Image Bytes** | Upload an image with damaged/truncated byte stream | Handled safely by Sharp/Pipeline without crashing; marked **REJECTED** (`INVALID_FORMAT`). |
| 18 | **Delete and Re-upload** | Click "Remove" on an accepted photo, then re-upload that photo | Original record and files deleted; re-uploaded photo passes without false positive duplicate conflict. |

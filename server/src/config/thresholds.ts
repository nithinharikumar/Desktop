export interface Thresholds {
  minFileBytes: number;
  minWidth: number;
  minHeight: number;
  blurThreshold: number;
  minFaceAreaRatio: number;
  similarityMaxDistance: number;
  maxUploadBytes: number;
  concurrency: number;
}

export function loadThresholds(env: Record<string, string | undefined>): Thresholds {
  return {
    minFileBytes: env['MIN_FILE_BYTES'] ? parseInt(env['MIN_FILE_BYTES'], 10) : 51200, // 50 KB
    minWidth: env['MIN_WIDTH'] ? parseInt(env['MIN_WIDTH'], 10) : 640,
    minHeight: env['MIN_HEIGHT'] ? parseInt(env['MIN_HEIGHT'], 10) : 640,
    blurThreshold: env['BLUR_THRESHOLD'] ? parseFloat(env['BLUR_THRESHOLD']) : 100,
    minFaceAreaRatio: env['MIN_FACE_AREA_RATIO'] ? parseFloat(env['MIN_FACE_AREA_RATIO']) : 0.05,
    similarityMaxDistance: env['SIMILARITY_MAX_DISTANCE'] ? parseInt(env['SIMILARITY_MAX_DISTANCE'], 10) : 5,
    maxUploadBytes: env['MAX_UPLOAD_BYTES'] ? parseInt(env['MAX_UPLOAD_BYTES'], 10) : 15728640, // 15 MB
    concurrency: env['CONCURRENCY'] ? parseInt(env['CONCURRENCY'], 10) : 3,
  };
}

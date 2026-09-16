export const MAX_UPLOAD_DURATION_S = 20 * 60;
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const UPLOADS_PER_HOUR_GLOBAL = 10;
export const UPLOADS_PER_HOUR_PER_VISITOR = 3;
/** "uploaded" rows older than this never got their file; transcribing/summarizing older than STALE_PROCESSING died. */
export const STALE_UPLOAD_MS = 60_000;
export const STALE_PROCESSING_MS = 6 * 60_000;

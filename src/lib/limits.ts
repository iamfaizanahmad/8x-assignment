// Hour-long meetings are the core case; 90 min leaves room for calls that overrun.
export const MAX_UPLOAD_DURATION_S = 90 * 60;
// Deepgram accepts pre-recorded files up to 2 GB; an hour of Zoom video is typically 0.3–1 GB.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const UPLOADS_PER_HOUR_GLOBAL = 10;
export const UPLOADS_PER_HOUR_PER_VISITOR = 3;
/** "uploaded" rows older than this never got their file; transcribing/summarizing older than STALE_PROCESSING died. */
export const STALE_UPLOAD_MS = 60_000;
export const STALE_PROCESSING_MS = 6 * 60_000;
export const ASK_PER_HOUR_PER_VISITOR = 30;
export const ASK_PER_HOUR_GLOBAL = 300;
export const ASK_MAX_QUESTION_CHARS = 500;
/** Library-wide questions include whole transcripts up to this size (~60k tokens), summaries beyond it. */
export const ASK_LIBRARY_TRANSCRIPT_CHARS = 240_000;

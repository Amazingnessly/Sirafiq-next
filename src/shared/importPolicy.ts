export const MEBIBYTE = 1024 * 1024;
export const TEBIBYTE = 1024 * 1024 * 1024 * 1024;

export const LOCAL_PDF_EXTRACTION_MAX_BYTES = 25 * MEBIBYTE;
export const SERVER_PDF_EXTRACTION_MAX_BYTES = 25 * MEBIBYTE;

// A single Worker request remains deliberately below Cloudflare's 100 MB
// request-body ceiling. Larger supports switch to R2 multipart automatically.
export const MAX_SINGLE_UPLOAD_BYTES = 90 * MEBIBYTE;
export const MULTIPART_UPLOAD_THRESHOLD_BYTES = MAX_SINGLE_UPLOAD_BYTES;
export const MULTIPART_PART_BYTES = 8 * MEBIBYTE;

// R2 multipart objects can reach 5 TiB. This is a storage limit, not a promise
// that every browser/device can select a file of that size comfortably.
export const MAX_RESOURCE_FILE_BYTES = 5 * TEBIBYTE;

// Kept as an alias while older sync code is migrated away from this name.
export const MAX_SYNC_FILE_BYTES = MAX_SINGLE_UPLOAD_BYTES;

export const MAX_EXTRACTED_CHARS = 2_000_000;
export const MAX_EXTRACTED_PAGES = 500;

export function shouldUseMultipartUpload(size: number): boolean {
  return size > MULTIPART_UPLOAD_THRESHOLD_BYTES;
}

export function shouldTryServerPdfExtraction(
  kind: 'text' | 'pdf',
  size: number,
  extractionStatus: 'ready' | 'failed',
): boolean {
  return kind === 'pdf' && extractionStatus === 'failed' && size <= SERVER_PDF_EXTRACTION_MAX_BYTES;
}

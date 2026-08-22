export const MEBIBYTE = 1024 * 1024;

export const LOCAL_PDF_EXTRACTION_MAX_BYTES = 25 * MEBIBYTE;
export const SERVER_PDF_EXTRACTION_MAX_BYTES = 25 * MEBIBYTE;

// A single Worker request remains deliberately below Cloudflare's 100 MB
// request-body ceiling. Larger supports switch to R2 multipart automatically.
export const MAX_SINGLE_UPLOAD_BYTES = 90 * MEBIBYTE;
export const MULTIPART_UPLOAD_THRESHOLD_BYTES = MAX_SINGLE_UPLOAD_BYTES;

// Device-safe sequential chunks for the iPad 6th gen target. R2 allows at
// most 10,000 multipart parts; keeping this fixed size gives the app a clear,
// testable ceiling without ever allocating giant per-part buffers on old iPads.
export const MULTIPART_PART_BYTES = 8 * MEBIBYTE;
export const MULTIPART_MAX_PARTS = 10_000;
export const MAX_RESOURCE_FILE_BYTES = MULTIPART_PART_BYTES * MULTIPART_MAX_PARTS;

// Kept as an alias while older sync code is migrated away from this name.
export const MAX_SYNC_FILE_BYTES = MAX_SINGLE_UPLOAD_BYTES;

export const MAX_EXTRACTED_CHARS = 2_000_000;
export const MAX_EXTRACTED_PAGES = 500;

export function multipartPartCount(size: number, partSize = MULTIPART_PART_BYTES): number {
  return size === 0 ? 0 : Math.ceil(size / partSize);
}

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

export const MEBIBYTE = 1024 * 1024;
export const LOCAL_PDF_EXTRACTION_MAX_BYTES = 25 * MEBIBYTE;
export const SERVER_PDF_EXTRACTION_MAX_BYTES = 25 * MEBIBYTE;
export const MAX_SYNC_FILE_BYTES = 90 * MEBIBYTE;
export const MAX_EXTRACTED_CHARS = 2_000_000;
export const MAX_EXTRACTED_PAGES = 500;

export function shouldTryServerPdfExtraction(
  kind: 'text' | 'pdf',
  size: number,
  extractionStatus: 'ready' | 'failed',
): boolean {
  return kind === 'pdf' && extractionStatus === 'failed' && size <= SERVER_PDF_EXTRACTION_MAX_BYTES;
}

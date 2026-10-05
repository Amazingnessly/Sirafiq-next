import { sha256BlobIncremental } from './incrementalSha256';

export async function sha256Hex(
  blob: Blob,
  onProgress?: (processedBytes: number, totalBytes: number) => void,
): Promise<string> {
  return sha256BlobIncremental(blob, 8 * 1024 * 1024, onProgress);
}

export async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Le navigateur ne permet pas de calculer l’empreinte du support.');
  }
  const digest = await subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

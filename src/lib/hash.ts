import { readBlobAsArrayBuffer } from './blob';

export async function sha256Hex(blob: Blob): Promise<string> {
  return sha256ArrayBuffer(await readBlobAsArrayBuffer(blob));
}

export async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Le navigateur ne permet pas de calculer l’empreinte du support.');
  }
  const digest = await subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

import type { MultipartUploadRecord, ResourceVersionRecord } from '../data/db';
import { sha256Hex } from './hash';
import type { TransferProgress } from './sync';

export function hasMatchingMultipartMetadata(
  file: File,
  version: ResourceVersionRecord,
  session: MultipartUploadRecord,
): boolean {
  return file.size === version.size
    && file.size === session.size
    && file.name === session.fileName
    && file.lastModified === session.lastModified;
}

/**
 * A resumed multipart upload must never trust file metadata alone. Two files can
 * have the same name, size and modification date while containing different
 * bytes. Re-hash the selected file before sending any remaining R2 parts.
 */
export async function verifyMultipartFileIdentity(
  file: File,
  version: ResourceVersionRecord,
  session: MultipartUploadRecord,
  onProgress?: (progress: TransferProgress) => void,
): Promise<void> {
  if (!hasMatchingMultipartMetadata(file, version, session)) {
    throw new Error('Le fichier sélectionné ne correspond pas au support à reprendre.');
  }

  const sha256 = await sha256Hex(file, (processedBytes, totalBytes) => {
    onProgress?.({ phase: 'hashing', processedBytes, totalBytes });
  });
  if (sha256 !== version.sha256 || sha256 !== session.sha256) {
    throw new Error('Le contenu du fichier sélectionné ne correspond pas au support à reprendre.');
  }
}

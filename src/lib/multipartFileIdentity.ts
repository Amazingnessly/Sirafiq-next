import type { MultipartUploadRecord, ResourceVersionRecord } from '../data/db';
import { sha256Hex } from './hash';
import type { TransferProgress } from './sync';

export function hasMatchingMultipartMetadata(
  file: Pick<File, 'size'>,
  version: Pick<ResourceVersionRecord, 'size'>,
  session: Pick<MultipartUploadRecord, 'size'>,
): boolean {
  return file.size === version.size && file.size === session.size;
}

/**
 * A resumed multipart upload must never trust file metadata alone. Names and
 * modification dates can legitimately change when iPadOS re-saves or copies a
 * file, while two different files can also share the same metadata. Size is a
 * cheap early rejection; SHA-256 is the authoritative identity check.
 */
export async function verifyFileAgainstVersion(
  file: File,
  version: Pick<ResourceVersionRecord, 'size' | 'sha256'>,
  onProgress?: (progress: TransferProgress) => void,
): Promise<void> {
  if (file.size !== version.size) {
    throw new Error('Le fichier sélectionné ne correspond pas au support à reprendre.');
  }

  const sha256 = await sha256Hex(file, (processedBytes, totalBytes) => {
    onProgress?.({ phase: 'hashing', processedBytes, totalBytes });
  });
  if (sha256 !== version.sha256) {
    throw new Error('Le contenu du fichier sélectionné ne correspond pas au support à reprendre.');
  }
}

export async function verifyMultipartFileIdentity(
  file: File,
  version: ResourceVersionRecord,
  session: MultipartUploadRecord,
  onProgress?: (progress: TransferProgress) => void,
): Promise<void> {
  if (!hasMatchingMultipartMetadata(file, version, session)) {
    throw new Error('Le fichier sélectionné ne correspond pas au support à reprendre.');
  }

  await verifyFileAgainstVersion(file, version, onProgress);
  if (version.sha256 !== session.sha256) {
    throw new Error('Le contenu du fichier sélectionné ne correspond pas au support à reprendre.');
  }
}

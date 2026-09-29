import { describe, expect, it } from 'vitest';
import type { MultipartUploadRecord, ResourceVersionRecord } from '../../src/data/db';
import { sha256Hex } from '../../src/lib/hash';
import { hasMatchingMultipartMetadata, verifyMultipartFileIdentity } from '../../src/lib/multipartFileIdentity';

function version(size: number, sha256 = 'hash'): ResourceVersionRecord {
  return {
    id: 'version-1',
    resourceId: 'resource-1',
    sha256,
    fileName: 'original.pdf',
    mimeType: 'application/pdf',
    size,
    bytes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    syncState: 'pending',
    syncError: null,
  };
}

function session(size: number, sha256 = 'hash'): MultipartUploadRecord {
  return {
    versionId: 'version-1',
    resourceId: 'resource-1',
    fileName: 'original.pdf',
    size,
    lastModified: 1,
    sha256,
    uploadId: 'upload-1',
    partSize: 8 * 1024 * 1024,
    parts: [],
    status: 'uploading',
    error: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function fileLike(size: number, name = 'original.pdf', lastModified = 1): File {
  return { size, name, lastModified } as File;
}

function blobFile(content: string): File {
  const blob = new Blob([content], { type: 'application/pdf' });
  return blob as File;
}

describe('multipart file identity metadata gate', () => {
  it('accepts an identical copy even when its name and timestamp changed', () => {
    expect(hasMatchingMultipartMetadata(fileLike(4, 'copy.pdf', 999), version(4), session(4))).toBe(true);
  });

  it('rejects a file whose size differs from the persisted version', () => {
    expect(hasMatchingMultipartMetadata(fileLike(3), version(4), session(4))).toBe(false);
  });

  it('rejects inconsistent persisted multipart metadata', () => {
    expect(hasMatchingMultipartMetadata(fileLike(4), version(4), session(5))).toBe(false);
  });
});

describe('multipart file identity SHA-256 gate', () => {
  it('accepts the exact persisted content', async () => {
    const file = blobFile('same-size-A');
    const sha256 = await sha256Hex(file);
    await expect(verifyMultipartFileIdentity(file, version(file.size, sha256), session(file.size, sha256))).resolves.toBeUndefined();
  });

  it('rejects different content even when its size is identical', async () => {
    const expected = blobFile('same-size-A');
    const selected = blobFile('same-size-B');
    expect(selected.size).toBe(expected.size);
    const sha256 = await sha256Hex(expected);
    await expect(verifyMultipartFileIdentity(selected, version(selected.size, sha256), session(selected.size, sha256)))
      .rejects.toThrow('Le contenu du fichier sélectionné ne correspond pas au support à reprendre.');
  });

  it('rejects inconsistent persisted hashes even when the selected file matches the version', async () => {
    const file = blobFile('same-size-A');
    const sha256 = await sha256Hex(file);
    await expect(verifyMultipartFileIdentity(file, version(file.size, sha256), session(file.size, 'different-hash')))
      .rejects.toThrow('Le contenu du fichier sélectionné ne correspond pas au support à reprendre.');
  });
});

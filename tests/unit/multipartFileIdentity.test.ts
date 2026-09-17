import { describe, expect, it } from 'vitest';
import type { MultipartUploadRecord, ResourceVersionRecord } from '../../src/data/db';
import { hasMatchingMultipartMetadata } from '../../src/lib/multipartFileIdentity';

function version(size: number): ResourceVersionRecord {
  return {
    id: 'version-1',
    resourceId: 'resource-1',
    sha256: 'hash',
    fileName: 'original.pdf',
    mimeType: 'application/pdf',
    size,
    bytes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    syncState: 'pending',
    syncError: null,
  };
}

function session(size: number): MultipartUploadRecord {
  return {
    versionId: 'version-1',
    resourceId: 'resource-1',
    fileName: 'original.pdf',
    size,
    lastModified: 1,
    sha256: 'hash',
    uploadId: 'upload-1',
    partSize: 8 * 1024 * 1024,
    parts: [],
    status: 'uploading',
    error: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('multipart file identity metadata gate', () => {
  it('accepts an identical copy even when its name and timestamp changed', () => {
    const file = new File(['abcd'], 'copy.pdf', { lastModified: 999 });
    expect(hasMatchingMultipartMetadata(file, version(4), session(4))).toBe(true);
  });

  it('rejects a file whose size differs from the persisted version', () => {
    const file = new File(['abc'], 'original.pdf', { lastModified: 1 });
    expect(hasMatchingMultipartMetadata(file, version(4), session(4))).toBe(false);
  });

  it('rejects inconsistent persisted multipart metadata', () => {
    const file = new File(['abcd'], 'original.pdf', { lastModified: 1 });
    expect(hasMatchingMultipartMetadata(file, version(4), session(5))).toBe(false);
  });
});

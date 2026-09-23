import { db } from './db';
import type { ResourceDetailPayload } from '../shared/contracts';

/**
 * Once a fully extracted text resource has been recovered from D1, keep its
 * textual content in IndexedDB as a synchronized local record. This makes the
 * text genuinely readable after a later offline reload without pretending that
 * remote-only PDF bytes are available locally.
 */
export async function cacheRemoteTextResource(detail: ResourceDetailPayload): Promise<boolean> {
  if (
    detail.resource.kind !== 'text'
    || detail.version.status !== 'ready'
    || detail.version.extractionStatus !== 'ready'
    || !detail.extraction
  ) {
    return false;
  }

  const existing = await db.resources.get(detail.resource.id);
  if (existing) return true;

  const duplicateVersion = await db.resourceVersions.where('sha256').equals(detail.version.sha256).first();
  if (duplicateVersion) return false;

  const cachedAt = new Date().toISOString();
  let cached = false;
  await db.transaction('rw', db.resources, db.resourceVersions, db.extractions, async () => {
    if (await db.resources.get(detail.resource.id)) {
      cached = true;
      return;
    }
    if (await db.resourceVersions.where('sha256').equals(detail.version.sha256).first()) return;

    await db.resources.add({
      id: detail.resource.id,
      subjectId: detail.resource.subjectId,
      title: detail.resource.title,
      kind: 'text',
      currentVersionId: detail.version.id,
      status: 'ready',
      extractionError: null,
      createdAt: detail.resource.createdAt,
      updatedAt: detail.resource.updatedAt,
      syncState: 'synced',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: detail.version.id,
      resourceId: detail.resource.id,
      sha256: detail.version.sha256,
      fileName: detail.version.fileName,
      mimeType: detail.version.mimeType,
      size: detail.version.size,
      bytes: null,
      createdAt: detail.resource.createdAt,
      syncState: 'synced',
      syncError: null,
    });
    await db.extractions.add({
      versionId: detail.version.id,
      status: 'ready',
      pages: detail.extraction.pages,
      charCount: detail.extraction.charCount,
      errorCode: null,
      errorMessage: null,
      createdAt: cachedAt,
    });
    cached = true;
  });

  return cached;
}

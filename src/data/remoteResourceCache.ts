import { db, type ResourceRecord } from './db';
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

  const extraction = detail.extraction;
  const duplicateVersion = await db.resourceVersions.where('sha256').equals(detail.version.sha256).first();
  const existing = await db.resources.get(detail.resource.id);
  if (duplicateVersion && !existing) return false;

  const cachedAt = new Date().toISOString();
  let cached = false;
  await db.transaction('rw', db.subjects, db.resources, db.resourceVersions, db.extractions, async () => {
    if (!(await db.subjects.get(detail.subject.id))) {
      await db.subjects.add({
        ...detail.subject,
        syncState: 'synced',
        syncError: null,
      });
    }

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
      pages: extraction.pages,
      charCount: extraction.charCount,
      errorCode: null,
      errorMessage: null,
      createdAt: cachedAt,
    });
    cached = true;
  });

  return cached;
}


/**
 * Repair a local resource whose metadata row survived but whose current
 * resourceVersions row disappeared. The remote detail is used only as a
 * fallback after IndexedDB has definitively reported the version missing.
 *
 * The local resource id/currentVersionId remain authoritative so existing
 * routes and references do not change. When duplicate reconciliation had
 * adopted a different server identity, that identity is restored through the
 * remoteVersionId field instead.
 */
export async function repairMissingLocalResourceVersion(
  resource: ResourceRecord,
  detail: ResourceDetailPayload,
): Promise<boolean> {
  const expectedRemoteResourceId = resource.remoteResourceId ?? resource.id;
  if (
    detail.resource.id !== expectedRemoteResourceId
    || detail.resource.kind !== resource.kind
    || detail.version.status === 'uploading'
  ) {
    return false;
  }

  const existing = await db.resourceVersions.get(resource.currentVersionId);
  if (existing) return true;

  const duplicateSha = await db.resourceVersions.where('sha256').equals(detail.version.sha256).first();
  if (duplicateSha && duplicateSha.id !== resource.currentVersionId) return false;

  const now = new Date().toISOString();
  let repaired = false;
  await db.transaction('rw', db.resources, db.resourceVersions, db.extractions, async () => {
    if (await db.resourceVersions.get(resource.currentVersionId)) {
      repaired = true;
      return;
    }
    const conflictingSha = await db.resourceVersions.where('sha256').equals(detail.version.sha256).first();
    if (conflictingSha && conflictingSha.id !== resource.currentVersionId) return;

    await db.resourceVersions.put({
      id: resource.currentVersionId,
      resourceId: resource.id,
      sha256: detail.version.sha256,
      fileName: detail.version.fileName,
      mimeType: detail.version.mimeType,
      size: detail.version.size,
      bytes: null,
      ...(detail.version.id !== resource.currentVersionId ? { remoteVersionId: detail.version.id } : {}),
      createdAt: resource.createdAt,
      syncState: 'synced',
      syncError: null,
    });

    if (detail.version.extractionStatus === 'ready' && detail.extraction) {
      await db.extractions.put({
        versionId: resource.currentVersionId,
        status: 'ready',
        pages: detail.extraction.pages,
        charCount: detail.extraction.charCount,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
      });
      await db.resources.update(resource.id, {
        status: 'ready',
        extractionError: null,
        syncState: 'synced',
        syncError: null,
      });
    } else if (detail.version.extractionStatus === 'failed') {
      const message = detail.version.extractionError ?? 'L’extraction distante a échoué.';
      await db.extractions.put({
        versionId: resource.currentVersionId,
        status: 'failed',
        pages: [],
        charCount: 0,
        errorCode: 'REMOTE_EXTRACTION_FAILED',
        errorMessage: message,
        createdAt: now,
      });
      await db.resources.update(resource.id, {
        status: 'failed',
        extractionError: message,
        syncState: 'synced',
        syncError: null,
      });
    } else {
      await db.resources.update(resource.id, {
        status: 'failed',
        extractionError: 'L’extraction synchronisée doit encore être récupérée.',
        syncState: 'synced',
        syncError: null,
      });
    }
    repaired = true;
  });

  return repaired;
}

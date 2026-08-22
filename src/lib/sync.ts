import { db, type OutboxRecord, type SubjectRecord } from '../data/db';
import { apiJson, apiPutBlob, ApiRequestError } from './api';
import type { ExtractionUploadInput, ResourceRegisterInput, ServerExtractionResult } from '../shared/contracts';
import { shouldTryServerPdfExtraction } from '../shared/importPolicy';

let activeSync: Promise<void> | null = null;

export function requestSync(): Promise<void> {
  if (activeSync) return activeSync;
  activeSync = runSync().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

export async function retryAllSyncErrorsNow(): Promise<void> {
  const outbox = await db.outbox.toArray();
  const now = Date.now();
  await db.transaction('rw', db.outbox, db.subjects, db.resources, db.resourceVersions, async () => {
    for (const item of outbox) {
      await db.outbox.update(item.id, { nextAttemptAt: now, lastError: null });
      if (item.type === 'subject.upsert') {
        await db.subjects.update(item.entityId, { syncState: 'pending', syncError: null });
      } else {
        const resource = await db.resources.get(item.entityId);
        if (resource) {
          await db.resources.update(resource.id, { syncState: 'pending', syncError: null });
          await db.resourceVersions.update(resource.currentVersionId, { syncState: 'pending', syncError: null });
        }
      }
    }
  });
  await requestSync();
}

export async function retryServerExtractionForResource(resourceId: string): Promise<ServerExtractionResult> {
  const resource = await db.resources.get(resourceId);
  if (!resource) throw new Error('Le support local est introuvable.');
  const version = await db.resourceVersions.get(resource.currentVersionId);
  const extraction = await db.extractions.get(resource.currentVersionId);
  if (!version || !extraction) throw new Error('Les données locales du support sont incomplètes.');
  if (!shouldTryServerPdfExtraction(resource.kind, version.size, extraction.status)) {
    throw new Error('Ce support ne peut pas utiliser l’extraction PDF serveur dans cette version.');
  }
  if (resource.syncState !== 'synced') {
    throw new Error('Synchronisez d’abord le fichier avant de relancer son extraction.');
  }

  const result = await apiJson<ServerExtractionResult>(
    `/api/resource-versions/${encodeURIComponent(version.id)}/server-extraction`,
    { method: 'POST' },
    120_000,
  );
  await applyServerExtractionResult(resource.id, version.id, result);
  return result;
}

export function installSyncTriggers(): () => void {
  const onOnline = () => void requestSync();
  window.addEventListener('online', onOnline);
  const timer = window.setInterval(() => {
    if (navigator.onLine) void requestSync();
  }, 30_000);
  void requestSync();
  return () => {
    window.removeEventListener('online', onOnline);
    window.clearInterval(timer);
  };
}

async function runSync(): Promise<void> {
  if (!navigator.onLine) return;
  while (navigator.onLine) {
    const due = await db.outbox.where('nextAttemptAt').belowOrEqual(Date.now()).sortBy('createdAt');
    const item = due[0];
    if (!item) return;
    try {
      if (item.type === 'subject.upsert') await syncSubject(item);
      if (item.type === 'resource.sync') await syncResource(item);
      await db.outbox.delete(item.id);
    } catch (error) {
      await markOutboxFailure(item, error);
      if (!navigator.onLine) return;
    }
  }
}

async function syncSubject(item: OutboxRecord): Promise<void> {
  const subject = await db.subjects.get(item.entityId);
  if (!subject) return;
  await apiJson('/api/subjects/upsert', {
    method: 'POST',
    body: JSON.stringify(toSubjectPayload(subject)),
  });
  await db.subjects.update(subject.id, { syncState: 'synced', syncError: null });
}

async function syncResource(item: OutboxRecord): Promise<void> {
  const resource = await db.resources.get(item.entityId);
  if (!resource) return;
  const version = await db.resourceVersions.get(resource.currentVersionId);
  const extraction = await db.extractions.get(resource.currentVersionId);
  if (!version || !extraction || !version.bytes) {
    throw new ApiRequestError('Les données locales du support sont incomplètes.', 0, 'LOCAL_DATA_MISSING', false);
  }

  const payload: ResourceRegisterInput = {
    resource: {
      id: resource.id,
      subjectId: resource.subjectId,
      title: resource.title,
      kind: resource.kind,
      currentVersionId: resource.currentVersionId,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
    },
    version: {
      id: version.id,
      resourceId: version.resourceId,
      sha256: version.sha256,
      fileName: version.fileName,
      mimeType: version.mimeType,
      size: version.size,
      createdAt: version.createdAt,
    },
  };

  await apiJson('/api/resources/register', { method: 'POST', body: JSON.stringify(payload) });
  const uploadBlob = new Blob([version.bytes], { type: version.mimeType });
  await apiPutBlob(`/api/resource-versions/${encodeURIComponent(version.id)}/blob`, uploadBlob, version.mimeType, 120_000);

  if (extraction.status === 'ready') {
    const extractionPayload: ExtractionUploadInput = {
      status: 'ready',
      pages: extraction.pages,
      charCount: extraction.charCount,
    };
    await apiJson(`/api/resource-versions/${encodeURIComponent(version.id)}/extraction`, {
      method: 'POST',
      body: JSON.stringify(extractionPayload),
    });
  } else if (shouldTryServerPdfExtraction(resource.kind, version.size, extraction.status)) {
    const serverResult = await apiJson<ServerExtractionResult>(
      `/api/resource-versions/${encodeURIComponent(version.id)}/server-extraction`,
      { method: 'POST' },
      120_000,
    );
    await applyServerExtractionResult(resource.id, version.id, serverResult);
  } else {
    await apiJson(`/api/resource-versions/${encodeURIComponent(version.id)}/extraction-failure`, {
      method: 'POST',
      body: JSON.stringify({
        code: extraction.errorCode ?? 'EXTRACTION_FAILED',
        message: extraction.errorMessage ?? 'Extraction impossible.',
      }),
    });
  }

  await db.transaction('rw', db.resources, db.resourceVersions, async () => {
    await db.resources.update(resource.id, { syncState: 'synced', syncError: null });
    await db.resourceVersions.update(version.id, { syncState: 'synced', syncError: null });
  });
}

async function applyServerExtractionResult(resourceId: string, versionId: string, result: ServerExtractionResult): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction('rw', db.resources, db.extractions, async () => {
    if (result.status === 'ready') {
      await db.extractions.put({
        versionId,
        status: 'ready',
        pages: result.pages,
        charCount: result.charCount,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
      });
      await db.resources.update(resourceId, {
        status: 'ready',
        extractionError: null,
        updatedAt: now,
      });
    } else {
      await db.extractions.put({
        versionId,
        status: 'failed',
        pages: [],
        charCount: 0,
        errorCode: result.code,
        errorMessage: result.message,
        createdAt: now,
      });
      await db.resources.update(resourceId, {
        status: 'failed',
        extractionError: result.message,
        updatedAt: now,
      });
    }
  });
}

async function markOutboxFailure(item: OutboxRecord, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Erreur de synchronisation inconnue.';
  const attempts = item.attempts + 1;
  const retryable = !(error instanceof ApiRequestError) || error.retryable;
  const nextDelay = Math.min(5 * 60_000, 2 ** Math.min(attempts, 6) * 1_000);

  await db.outbox.update(item.id, {
    attempts,
    lastError: message,
    nextAttemptAt: retryable ? Date.now() + nextDelay : Number.MAX_SAFE_INTEGER,
  });

  if (item.type === 'subject.upsert') {
    await db.subjects.update(item.entityId, { syncState: 'error', syncError: message });
  } else {
    const resource = await db.resources.get(item.entityId);
    if (resource) {
      await db.transaction('rw', db.resources, db.resourceVersions, async () => {
        await db.resources.update(resource.id, { syncState: 'error', syncError: message });
        await db.resourceVersions.update(resource.currentVersionId, { syncState: 'error', syncError: message });
      });
    }
  }
}

function toSubjectPayload(subject: SubjectRecord) {
  return {
    id: subject.id,
    name: subject.name,
    parentId: subject.parentId,
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
  };
}

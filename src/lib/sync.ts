import {
  db,
  type OutboxRecord,
  type ResourceRecord,
  type ResourceVersionRecord,
  type SubjectRecord,
} from '../data/db';
import { apiJson, apiPutBinary, apiPutBlob, ApiRequestError } from './api';
import type {
  ExtractionUploadInput,
  MultipartCreateResult,
  ResourceDetailPayload,
  ResourceRegisterInput,
  ServerExtractionResult,
  UploadedPart,
} from '../shared/contracts';
import { MULTIPART_PART_BYTES, shouldTryServerExtraction } from '../shared/importPolicy';
import { newId } from './ids';
import { isRetryableOutboxAttempt } from './retryableSync';

let activeSync: Promise<void> | null = null;
const activeSubjectSyncs = new Map<string, Promise<void>>();
let retryTimer: number | null = null;
let retryTimerAt: number | null = null;

type RemoteRegistration = {
  resourceId: string;
  versionId: string;
  reusedExisting: boolean;
  remote: ResourceDetailPayload | null;
};

export type TransferProgress = {
  phase: 'hashing' | 'uploading' | 'finalizing';
  processedBytes: number;
  totalBytes: number;
  partNumber?: number;
  partCount?: number;
};

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

export async function uploadMultipartResource(
  resourceId: string,
  file: File,
  onProgress?: (progress: TransferProgress) => void,
): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) throw new Error('Le support local est introuvable.');
  const version = await db.resourceVersions.get(resource.currentVersionId);
  const extraction = await db.extractions.get(resource.currentVersionId);
  const localSession = await db.multipartUploads.get(resource.currentVersionId);
  if (!version || !extraction || !localSession) throw new Error('La session d’envoi multipart est introuvable.');
  if (file.size !== version.size) throw new Error('Le fichier sélectionné n’a pas la taille du support à reprendre.');

  try {
    await db.transaction('rw', db.resources, db.resourceVersions, db.multipartUploads, async () => {
      await db.resources.update(resource.id, { syncState: 'pending', syncError: null });
      await db.resourceVersions.update(version.id, { syncState: 'pending', syncError: null });
      await db.multipartUploads.update(version.id, { status: 'uploading', error: null, updatedAt: new Date().toISOString() });
    });

    await ensureSubjectSynced(resource.subjectId);

    const registration = await registerOrResolveRemoteVersion(toResourcePayload(resource, version));
    await rememberRemoteIdentity(resource.id, version.id, registration);
    if (registration.reusedExisting) {
      if (registration.remote?.version.extractionStatus === 'ready' && registration.remote.extraction) {
        await applyServerExtractionResult(resource.id, version.id, {
          status: 'ready',
          pages: registration.remote.extraction.pages,
          charCount: registration.remote.extraction.charCount,
        });
      }
      await markMultipartSynced(resource.id, version.id);
      return;
    }

    await uploadMultipartParts(registration.versionId, version, file, false, onProgress);

    onProgress?.({ phase: 'finalizing', processedBytes: file.size, totalBytes: file.size });
    const session = await db.multipartUploads.get(version.id);
    if (!session?.uploadId) throw new Error('La session multipart a disparu avant la finalisation.');
    await apiJson(`/api/resource-versions/${encodeURIComponent(registration.versionId)}/multipart/complete`, {
      method: 'POST',
      body: JSON.stringify({ uploadId: session.uploadId }),
    }, 120_000);

    if (extraction.status === 'ready') {
      const payload: ExtractionUploadInput = { status: 'ready', pages: extraction.pages, charCount: extraction.charCount };
      await apiJson(`/api/resource-versions/${encodeURIComponent(registration.versionId)}/extraction`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } else {
      await apiJson(`/api/resource-versions/${encodeURIComponent(registration.versionId)}/extraction-failure`, {
        method: 'POST',
        body: JSON.stringify({
          code: extraction.errorCode ?? 'LARGE_FILE_EXTRACTION_DEFERRED',
          message: extraction.errorMessage ?? 'Le fichier est stocké, mais son extraction automatique est différée.',
        }),
      });
    }

    await markMultipartSynced(resource.id, version.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'L’envoi multipart a échoué.';
    await db.transaction('rw', db.resources, db.resourceVersions, db.multipartUploads, async () => {
      await db.resources.update(resource.id, { syncState: 'error', syncError: message });
      await db.resourceVersions.update(version.id, { syncState: 'error', syncError: message });
      await db.multipartUploads.update(version.id, { status: 'error', error: message, updatedAt: new Date().toISOString() });
    });
    throw error;
  }
}

async function uploadMultipartParts(
  remoteVersionId: string,
  version: ResourceVersionRecord,
  file: File,
  restart: boolean,
  onProgress?: (progress: TransferProgress) => void,
): Promise<void> {
  const created = await apiJson<MultipartCreateResult>(
    `/api/resource-versions/${encodeURIComponent(remoteVersionId)}/multipart/create`,
    { method: 'POST', body: JSON.stringify({ partSize: MULTIPART_PART_BYTES, restart }) },
  );
  await db.multipartUploads.update(version.id, {
    uploadId: created.uploadId,
    partSize: created.partSize,
    parts: created.parts,
    status: 'uploading',
    error: null,
    updatedAt: new Date().toISOString(),
  });

  const partCount = Math.ceil(file.size / created.partSize);
  const completed = new Map(created.parts.map((part) => [part.partNumber, part]));
  let processedBytes = 0;
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    const start = (partNumber - 1) * created.partSize;
    const end = Math.min(start + created.partSize, file.size);
    if (completed.has(partNumber)) {
      processedBytes += end - start;
      onProgress?.({ phase: 'uploading', processedBytes, totalBytes: file.size, partNumber, partCount });
      continue;
    }

    const chunk = file.slice(start, end, version.mimeType);
    try {
      const uploaded = await apiPutBinary<UploadedPart>(
        `/api/resource-versions/${encodeURIComponent(remoteVersionId)}/multipart/part?uploadId=${encodeURIComponent(created.uploadId)}&partNumber=${partNumber}`,
        chunk,
        version.mimeType,
        { 'X-Sirafiq-Part-Size': String(chunk.size) },
        120_000,
      );
      completed.set(uploaded.partNumber, uploaded);
      processedBytes += chunk.size;
      const parts = [...completed.values()].sort((a, b) => a.partNumber - b.partNumber);
      await db.multipartUploads.update(version.id, { parts, updatedAt: new Date().toISOString() });
      onProgress?.({ phase: 'uploading', processedBytes, totalBytes: file.size, partNumber, partCount });
    } catch (error) {
      if (!restart && error instanceof ApiRequestError && error.code === 'MULTIPART_SESSION_INVALID') {
        await db.multipartUploads.update(version.id, { uploadId: null, parts: [], updatedAt: new Date().toISOString() });
        await uploadMultipartParts(remoteVersionId, version, file, true, onProgress);
        return;
      }
      throw error;
    }
  }
}

async function markMultipartSynced(resourceId: string, versionId: string): Promise<void> {
  await db.transaction('rw', db.resources, db.resourceVersions, db.multipartUploads, db.outbox, async () => {
    await db.resources.update(resourceId, { syncState: 'synced', syncError: null });
    await db.resourceVersions.update(versionId, { syncState: 'synced', syncError: null });
    await db.multipartUploads.delete(versionId);
    await db.outbox.where('entityId').equals(resourceId).and((item) => item.type === 'resource.sync').delete();
  });
}

export async function retryServerExtractionForResource(resourceId: string): Promise<ServerExtractionResult> {
  const resource = await db.resources.get(resourceId);
  if (!resource) throw new Error('Le support local est introuvable.');
  const version = await db.resourceVersions.get(resource.currentVersionId);
  const extraction = await db.extractions.get(resource.currentVersionId);
  if (!version || !extraction) throw new Error('Les données locales du support sont incomplètes.');
  if (!shouldTryServerExtraction(resource.kind, version.size, extraction.status)) {
    throw new Error('Ce support ne peut pas utiliser l’extraction serveur dans cette version.');
  }
  if (resource.syncState !== 'synced') throw new Error('Synchronisez d’abord le fichier avant de relancer son extraction.');

  const registration = await registerOrResolveRemoteVersion(toResourcePayload(resource, version));
  await rememberRemoteIdentity(resource.id, version.id, registration);
  if (registration.remote?.version.extractionStatus === 'ready' && registration.remote.extraction) {
    const ready: ServerExtractionResult = {
      status: 'ready',
      pages: registration.remote.extraction.pages,
      charCount: registration.remote.extraction.charCount,
    };
    await applyServerExtractionResult(resource.id, version.id, ready);
    return ready;
  }

  const result = await apiJson<ServerExtractionResult>(
    `/api/resource-versions/${encodeURIComponent(registration.versionId)}/server-extraction`,
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
  void restorePersistedRetryDeadline();
  void requestSync();
  return () => {
    window.removeEventListener('online', onOnline);
    window.clearInterval(timer);
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
      retryTimerAt = null;
    }
  };
}

async function restorePersistedRetryDeadline(): Promise<void> {
  const now = Date.now();
  const future = await db.outbox.where('nextAttemptAt').above(now).sortBy('nextAttemptAt');
  const next = future[0];
  if (next && next.nextAttemptAt < Number.MAX_SAFE_INTEGER) {
    scheduleRetry(Math.max(0, next.nextAttemptAt - Date.now()));
  }
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
      // Subject synchronization owns its own failure bookkeeping so every
      // caller that joins the same in-flight request observes one durable
      // outcome instead of incrementing the same outbox attempt twice.
      if (item.type !== 'subject.upsert') await markOutboxFailure(item, error);
      if (!navigator.onLine) return;
    }
  }
}

async function ensureSubjectSynced(
  subjectId: string,
  options: { force?: boolean; respectBackoff?: boolean } = {},
): Promise<void> {
  await synchronizeSubjectById(subjectId, options);
}

async function syncSubject(item: OutboxRecord): Promise<void> {
  await synchronizeSubjectById(item.entityId, { force: true }, item);
}

async function synchronizeSubjectById(
  subjectId: string,
  options: { force?: boolean; respectBackoff?: boolean } = {},
  workHint?: OutboxRecord,
): Promise<void> {
  const existing = activeSubjectSyncs.get(subjectId);
  if (existing) {
    await existing;
    return;
  }

  const task = performSubjectSync(subjectId, options, workHint);
  activeSubjectSyncs.set(subjectId, task);
  try {
    await task;
  } finally {
    if (activeSubjectSyncs.get(subjectId) === task) activeSubjectSyncs.delete(subjectId);
  }
}

async function performSubjectSync(
  subjectId: string,
  options: { force?: boolean; respectBackoff?: boolean },
  workHint?: OutboxRecord,
): Promise<void> {
  const { force = false, respectBackoff = false } = options;
  const subject = await db.subjects.get(subjectId);
  if (!subject) {
    if (workHint) return;
    throw new ApiRequestError('La matière locale est introuvable.', 0, 'LOCAL_SUBJECT_MISSING', false);
  }
  if (subject.syncState === 'synced' && !force) return;

  let work = workHint ?? await db.outbox
    .where('entityId')
    .equals(subject.id)
    .and((item) => item.type === 'subject.upsert')
    .first();

  if (work?.lastError) {
    if (!isRetryableOutboxAttempt(work.nextAttemptAt)) {
      throw new ApiRequestError(
        work.lastError,
        0,
        'SUBJECT_SYNC_BLOCKED',
        false,
      );
    }
    if (respectBackoff && work.nextAttemptAt > Date.now()) {
      throw new ApiRequestError(
        work.lastError,
        0,
        'SUBJECT_SYNC_BACKOFF',
        true,
        { nextAttemptAt: work.nextAttemptAt },
      );
    }
  }

  if (!work) {
    work = {
      id: newId(),
      type: 'subject.upsert',
      entityId: subject.id,
      attempts: 0,
      nextAttemptAt: Date.now(),
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    await db.outbox.add(work);
  }

  try {
    await apiJson('/api/subjects/upsert', {
      method: 'POST',
      body: JSON.stringify(toSubjectPayload(subject)),
    });
    await db.transaction('rw', db.subjects, db.outbox, async () => {
      await db.subjects.update(subject.id, { syncState: 'synced', syncError: null });
      await db.outbox
        .where('entityId')
        .equals(subject.id)
        .and((item) => item.type === 'subject.upsert')
        .delete();
    });
    await releaseDeferredResourcesForSubject(subject.id);
  } catch (error) {
    await markOutboxFailure(work, error);
    throw error;
  }
}

async function syncResource(item: OutboxRecord): Promise<void> {
  const resource = await db.resources.get(item.entityId);
  if (!resource) return;
  const multipart = await db.multipartUploads.get(resource.currentVersionId);
  if (multipart) return;

  // D1 rejects a resource whose subject is not present yet. Keep the ordinary
  // sync path aligned with multipart: satisfy that dependency before attempting
  // resource registration instead of manufacturing a secondary SUBJECT_MISSING
  // failure on an otherwise valid local support.
  await ensureSubjectSynced(resource.subjectId, { respectBackoff: true });

  const version = await db.resourceVersions.get(resource.currentVersionId);
  const extraction = await db.extractions.get(resource.currentVersionId);
  if (!version || !extraction || !version.bytes) {
    throw new ApiRequestError('Les données locales du support sont incomplètes.', 0, 'LOCAL_DATA_MISSING', false);
  }

  const registration = await registerOrResolveRemoteVersion(toResourcePayload(resource, version));
  await rememberRemoteIdentity(resource.id, version.id, registration);
  if (!registration.reusedExisting) {
    const uploadBlob = new Blob([version.bytes], { type: version.mimeType });
    await apiPutBlob(`/api/resource-versions/${encodeURIComponent(registration.versionId)}/blob`, uploadBlob, version.mimeType, 120_000);
  }

  if (extraction.status === 'ready') {
    const extractionPayload: ExtractionUploadInput = { status: 'ready', pages: extraction.pages, charCount: extraction.charCount };
    await apiJson(`/api/resource-versions/${encodeURIComponent(registration.versionId)}/extraction`, {
      method: 'POST', body: JSON.stringify(extractionPayload),
    });
  } else if (registration.remote?.version.extractionStatus === 'ready' && registration.remote.extraction) {
    await applyServerExtractionResult(resource.id, version.id, {
      status: 'ready', pages: registration.remote.extraction.pages, charCount: registration.remote.extraction.charCount,
    });
  } else if (shouldTryServerExtraction(resource.kind, version.size, extraction.status)) {
    const serverResult = await apiJson<ServerExtractionResult>(
      `/api/resource-versions/${encodeURIComponent(registration.versionId)}/server-extraction`, { method: 'POST' }, 120_000,
    );
    await applyServerExtractionResult(resource.id, version.id, serverResult);
  } else if (!registration.reusedExisting) {
    await apiJson(`/api/resource-versions/${encodeURIComponent(registration.versionId)}/extraction-failure`, {
      method: 'POST',
      body: JSON.stringify({ code: extraction.errorCode ?? 'EXTRACTION_FAILED', message: extraction.errorMessage ?? 'Extraction impossible.' }),
    });
  }

  await db.transaction('rw', db.resources, db.resourceVersions, async () => {
    await db.resources.update(resource.id, { syncState: 'synced', syncError: null });
    await db.resourceVersions.update(version.id, { syncState: 'synced', syncError: null });
  });
}

async function releaseDeferredResourcesForSubject(subjectId: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.resources, db.outbox, async () => {
    const pendingResources = await db.resources
      .where('subjectId')
      .equals(subjectId)
      .filter((resource) => resource.syncState === 'pending')
      .toArray();
    if (pendingResources.length === 0) return;

    const pendingResourceIds = new Set(pendingResources.map((resource) => resource.id));
    const deferred = (await db.outbox.where('type').equals('resource.sync').toArray()).filter(
      (item) => pendingResourceIds.has(item.entityId)
        && Boolean(item.lastError),
    );
    for (const item of deferred) {
      await db.outbox.update(item.id, { nextAttemptAt: now, lastError: null });
    }
  });
}

async function rememberRemoteIdentity(
  localResourceId: string,
  localVersionId: string,
  registration: RemoteRegistration,
): Promise<void> {
  await db.transaction('rw', db.resources, db.resourceVersions, async () => {
    if (registration.resourceId !== localResourceId) {
      await db.resources.update(localResourceId, { remoteResourceId: registration.resourceId });
    }
    if (registration.versionId !== localVersionId) {
      await db.resourceVersions.update(localVersionId, { remoteVersionId: registration.versionId });
    }
  });
}

async function registerOrResolveRemoteVersion(
  payload: ResourceRegisterInput,
  repairedMissingSubject = false,
): Promise<RemoteRegistration> {
  try {
    await apiJson('/api/resources/register', { method: 'POST', body: JSON.stringify(payload) });
    return { resourceId: payload.resource.id, versionId: payload.version.id, reusedExisting: false, remote: null };
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === 'SUBJECT_MISSING' && !repairedMissingSubject) {
      await ensureSubjectSynced(payload.resource.subjectId, { force: true });
      return registerOrResolveRemoteVersion(payload, true);
    }
    if (!(error instanceof ApiRequestError) || error.code !== 'DUPLICATE_SUPPORT') throw error;
    const existingResourceId = readExistingResourceId(error.details);
    if (!existingResourceId) {
      throw new ApiRequestError('Le serveur a signalé un doublon sans fournir le support existant.', 409, 'DUPLICATE_RECONCILIATION_FAILED', true, error.details);
    }
    const remote = await apiJson<ResourceDetailPayload>(`/api/resources/${encodeURIComponent(existingResourceId)}`);
    return { resourceId: remote.resource.id, versionId: remote.version.id, reusedExisting: true, remote };
  }
}

function readExistingResourceId(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const candidate = (details as { existingResourceId?: unknown }).existingResourceId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function toResourcePayload(resource: ResourceRecord, version: ResourceVersionRecord): ResourceRegisterInput {
  return {
    resource: {
      id: resource.id, subjectId: resource.subjectId, title: resource.title, kind: resource.kind,
      currentVersionId: resource.currentVersionId, createdAt: resource.createdAt, updatedAt: resource.updatedAt,
    },
    version: {
      id: version.id, resourceId: version.resourceId, sha256: version.sha256, fileName: version.fileName,
      mimeType: version.mimeType, size: version.size, createdAt: version.createdAt,
    },
  };
}

async function applyServerExtractionResult(resourceId: string, versionId: string, result: ServerExtractionResult): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction('rw', db.resources, db.extractions, async () => {
    if (result.status === 'ready') {
      await db.extractions.put({ versionId, status: 'ready', pages: result.pages, charCount: result.charCount, errorCode: null, errorMessage: null, createdAt: now });
      await db.resources.update(resourceId, { status: 'ready', extractionError: null, updatedAt: now });
    } else {
      await db.extractions.put({ versionId, status: 'failed', pages: [], charCount: 0, errorCode: result.code, errorMessage: result.message, createdAt: now });
      await db.resources.update(resourceId, { status: 'failed', extractionError: result.message, updatedAt: now });
    }
  });
}

async function markOutboxFailure(item: OutboxRecord, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Erreur de synchronisation inconnue.';

  if (error instanceof ApiRequestError && error.code === 'SUBJECT_SYNC_BACKOFF') {
    const subjectRetryAt = readRetryDeadline(error.details);
    if (subjectRetryAt !== null) {
      await db.outbox.update(item.id, { lastError: message, nextAttemptAt: subjectRetryAt });
      scheduleRetry(Math.max(0, subjectRetryAt - Date.now()));
      return;
    }
  }

  // A resource is not terminal merely because its subject currently is.
  // Park the resource behind the blocked dependency without consuming one of
  // its own attempts or presenting the support itself as broken. If the
  // subject is later repaired, releaseDeferredResourcesForSubject() makes this
  // work immediately due again.
  if (error instanceof ApiRequestError && error.code === 'SUBJECT_SYNC_BLOCKED') {
    await db.outbox.update(item.id, {
      lastError: message,
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
    });
    return;
  }

  const attempts = item.attempts + 1;
  const retryable = !(error instanceof ApiRequestError) || error.retryable;
  const nextDelay = Math.min(5 * 60_000, 2 ** Math.min(attempts, 6) * 1_000);
  const nextAttemptAt = retryable ? Date.now() + nextDelay : Number.MAX_SAFE_INTEGER;
  await db.outbox.update(item.id, { attempts, lastError: message, nextAttemptAt });
  if (retryable) scheduleRetry(nextDelay);

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

function readRetryDeadline(details: unknown): number | null {
  if (!details || typeof details !== 'object') return null;
  const candidate = (details as { nextAttemptAt?: unknown }).nextAttemptAt;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function scheduleRetry(delay: number): void {
  const targetAt = Date.now() + delay;
  if (retryTimer !== null && retryTimerAt !== null && retryTimerAt <= targetAt) return;
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimerAt = targetAt;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    retryTimerAt = null;
    if (navigator.onLine) void requestSync();
  }, delay);
}

function toSubjectPayload(subject: SubjectRecord) {
  return { id: subject.id, name: subject.name, parentId: subject.parentId, createdAt: subject.createdAt, updatedAt: subject.updatedAt };
}

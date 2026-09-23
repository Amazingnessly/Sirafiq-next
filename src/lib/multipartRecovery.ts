import { db } from '../data/db';
import type {
  ExtractionUploadInput,
  MultipartCreateResult,
  ResourceDetailPayload,
  ServerExtractionResult,
} from '../shared/contracts';
import { MULTIPART_PART_BYTES } from '../shared/importPolicy';
import { ApiRequestError, apiJson } from './api';
import { verifyMultipartFileIdentity } from './multipartFileIdentity';
import { uploadMultipartResource, type TransferProgress } from './sync';

const FINALIZATION_RECOVERY_CODES = new Set([
  'MULTIPART_COMPLETE_FAILED',
  'INVALID_MULTIPART_SESSION',
  'NETWORK_ERROR',
  'TIMEOUT',
]);

export async function recoverInterruptedMultipartSessionsAfterReload(): Promise<number> {
  const activeSessions = await db.multipartUploads.filter((session) => session.status !== 'error').toArray();
  if (activeSessions.length === 0) return 0;

  const message = 'L’envoi a été interrompu par un rechargement ou une fermeture. Resélectionnez le même fichier pour reprendre.';
  const now = new Date().toISOString();
  let recovered = 0;

  await db.transaction('rw', db.resources, db.resourceVersions, db.multipartUploads, async () => {
    for (const session of activeSessions) {
      const resource = await db.resources.get(session.resourceId);

      // A synchronized resource has already received durable confirmation from
      // R2. An active multipart record beside it can only be stale residue.
      if (resource?.syncState === 'synced') {
        await db.multipartUploads.delete(session.versionId);
        continue;
      }

      await db.multipartUploads.update(session.versionId, {
        status: 'error',
        error: message,
        updatedAt: now,
      });
      await db.resourceVersions.update(session.versionId, {
        syncState: 'error',
        syncError: message,
      });
      if (resource?.currentVersionId === session.versionId) {
        await db.resources.update(resource.id, {
          syncState: 'error',
          syncError: message,
        });
      }
      recovered += 1;
    }
  });

  return recovered;
}

export async function uploadMultipartResourceWithRecovery(
  resourceId: string,
  file: File,
  onProgress?: (progress: TransferProgress) => void,
): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) throw new Error('Le support local est introuvable.');
  const version = await db.resourceVersions.get(resource.currentVersionId);
  const session = await db.multipartUploads.get(resource.currentVersionId);
  if (!version || !session) throw new Error('La session multipart locale est introuvable.');

  // A brand-new local multipart session has no durable remote state to
  // reconcile yet. Recovery sessions, on the other hand, must first check
  // whether R2 already finalized the object before any bytes are resent.
  const mayHaveRemoteProgress = session.status !== 'pending'
    || session.uploadId !== null
    || session.parts.length > 0;
  if (mayHaveRemoteProgress) {
    try {
      if (await reconcileAlreadyStoredRemote(resourceId)) return;
    } catch (error) {
      await markMultipartRecoveryFailure(resourceId, error);
      throw error;
    }
  }

  try {
    await verifyMultipartFileIdentity(file, version, session, onProgress);
  } catch (error) {
    // A first upload must never remain visually "in progress" if Safari loses
    // access to the File or hashing fails before the network phase begins.
    // Existing recovery sessions already carry the durable error that led the
    // user here, so preserve it when a reselected file is simply incorrect.
    if (session.status !== 'error') await markMultipartRecoveryFailure(resourceId, error);
    throw error;
  }

  let lastPhase: TransferProgress['phase'] | null = null;
  const forwardProgress = (progress: TransferProgress) => {
    lastPhase = progress.phase;
    onProgress?.(progress);
  };

  try {
    // Keep the existing upload id and confirmed parts first. If all parts are
    // already present, the proven path simply retries complete() without upload.
    await uploadMultipartResource(resourceId, file, forwardProgress);
  } catch (error) {
    const canRecoverFinalization = lastPhase === 'finalizing'
      && error instanceof ApiRequestError
      && FINALIZATION_RECOVERY_CODES.has(error.code);
    if (!canRecoverFinalization) throw error;

    // complete() may have succeeded in R2 before the response disappeared.
    if (await reconcileAlreadyStoredRemote(resourceId)) return;

    // Otherwise the old upload can no longer be trusted (for example an
    // expired R2 multipart id). Create exactly one fresh session and retry.
    await forceFreshMultipartSession(resourceId);
    await uploadMultipartResource(resourceId, file, forwardProgress);
  }
}

async function markMultipartRecoveryFailure(resourceId: string, error: unknown): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) return;
  const [version, session] = await Promise.all([
    db.resourceVersions.get(resource.currentVersionId),
    db.multipartUploads.get(resource.currentVersionId),
  ]);
  if (!version || !session) return;

  const message = error instanceof Error ? error.message : 'La reprise de l’envoi multipart a échoué.';
  await db.transaction('rw', db.resources, db.resourceVersions, db.multipartUploads, async () => {
    await db.resources.update(resource.id, { syncState: 'error', syncError: message });
    await db.resourceVersions.update(version.id, { syncState: 'error', syncError: message });
    await db.multipartUploads.update(session.versionId, {
      status: 'error',
      error: message,
      updatedAt: new Date().toISOString(),
    });
  });
}

async function reconcileAlreadyStoredRemote(resourceId: string): Promise<boolean> {
  const resource = await db.resources.get(resourceId);
  if (!resource) throw new Error('Le support local est introuvable.');
  const version = await db.resourceVersions.get(resource.currentVersionId);
  const extraction = await db.extractions.get(resource.currentVersionId);
  const session = await db.multipartUploads.get(resource.currentVersionId);
  if (!version || !extraction || !session) return false;

  let remote: ResourceDetailPayload;
  try {
    remote = await apiJson<ResourceDetailPayload>(`/api/resources/${encodeURIComponent(resource.id)}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return false;
    throw error;
  }

  const sameObject = remote.version.id === version.id
    && remote.version.sha256 === version.sha256
    && remote.version.size === version.size;
  if (!sameObject || remote.version.status === 'uploading') return false;

  if (remote.version.extractionStatus === 'ready' && remote.extraction) {
    const result: ServerExtractionResult = {
      status: 'ready',
      pages: remote.extraction.pages,
      charCount: remote.extraction.charCount,
    };
    await applyRemoteExtraction(resource.id, version.id, result);
  } else if (extraction.status === 'ready') {
    const payload: ExtractionUploadInput = {
      status: 'ready',
      pages: extraction.pages,
      charCount: extraction.charCount,
    };
    await apiJson(`/api/resource-versions/${encodeURIComponent(version.id)}/extraction`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } else if (remote.version.extractionStatus !== 'failed') {
    await apiJson(`/api/resource-versions/${encodeURIComponent(version.id)}/extraction-failure`, {
      method: 'POST',
      body: JSON.stringify({
        code: extraction.errorCode ?? 'LARGE_FILE_EXTRACTION_DEFERRED',
        message: extraction.errorMessage ?? 'Le fichier est stocké, mais son extraction automatique est différée.',
      }),
    });
  }

  await db.transaction('rw', db.resources, db.resourceVersions, db.multipartUploads, db.outbox, async () => {
    await db.resources.update(resource.id, { syncState: 'synced', syncError: null });
    await db.resourceVersions.update(version.id, { syncState: 'synced', syncError: null });
    await db.multipartUploads.delete(version.id);
    await db.outbox.where('entityId').equals(resource.id).and((item) => item.type === 'resource.sync').delete();
  });
  return true;
}

async function forceFreshMultipartSession(resourceId: string): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) throw new Error('Le support local est introuvable.');
  const version = await db.resourceVersions.get(resource.currentVersionId);
  const session = await db.multipartUploads.get(resource.currentVersionId);
  if (!version || !session) throw new Error('La session multipart locale est introuvable.');

  const partSize = session.partSize || MULTIPART_PART_BYTES;
  const fresh = await apiJson<MultipartCreateResult>(
    `/api/resource-versions/${encodeURIComponent(version.id)}/multipart/create`,
    { method: 'POST', body: JSON.stringify({ partSize, restart: true }) },
  );
  await db.multipartUploads.update(version.id, {
    uploadId: fresh.uploadId,
    partSize: fresh.partSize,
    parts: fresh.parts,
    status: 'uploading',
    error: null,
    updatedAt: new Date().toISOString(),
  });
}

async function applyRemoteExtraction(
  resourceId: string,
  versionId: string,
  result: ServerExtractionResult,
): Promise<void> {
  if (result.status !== 'ready') return;
  const now = new Date().toISOString();
  await db.transaction('rw', db.resources, db.extractions, async () => {
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
  });
}

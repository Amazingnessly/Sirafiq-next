import { db } from '../data/db';
import type {
  ExtractionUploadInput,
  MultipartCreateResult,
  ResourceDetailPayload,
  ServerExtractionResult,
} from '../shared/contracts';
import { MULTIPART_PART_BYTES } from '../shared/importPolicy';
import { ApiRequestError, apiJson } from './api';
import { uploadMultipartResource, type TransferProgress } from './sync';

const FINALIZATION_RECOVERY_CODES = new Set([
  'MULTIPART_COMPLETE_FAILED',
  'INVALID_MULTIPART_SESSION',
  'NETWORK_ERROR',
  'TIMEOUT',
]);

export async function uploadMultipartResourceWithRecovery(
  resourceId: string,
  file: File,
  onProgress?: (progress: TransferProgress) => void,
): Promise<void> {
  // If the final R2 assembly succeeded but its HTTP response was lost, do not
  // resend a large file: reconcile the durable remote state first.
  if (await reconcileAlreadyStoredRemote(resourceId)) return;

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

  await db.transaction('rw', db.resources, db.resourceVersions, db.multipartUploads, async () => {
    await db.resources.update(resource.id, { syncState: 'synced', syncError: null });
    await db.resourceVersions.update(version.id, { syncState: 'synced', syncError: null });
    await db.multipartUploads.delete(version.id);
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

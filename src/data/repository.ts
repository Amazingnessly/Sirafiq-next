import {
  db,
  type ExtractionRecord,
  type MultipartUploadRecord,
  type ResourceRecord,
  type ResourceVersionRecord,
  type SubjectRecord,
} from './db';
import { readBlobAsArrayBuffer } from '../lib/blob';
import { sha256ArrayBuffer, sha256Hex } from '../lib/hash';
import { isoNow, newId } from '../lib/ids';
import { requestSync, uploadMultipartResource, type TransferProgress } from '../lib/sync';
import {
  MAX_RESOURCE_FILE_BYTES,
  MULTIPART_PART_BYTES,
  shouldUseMultipartUpload,
} from '../shared/importPolicy';
import type { ResourceKind } from '../shared/contracts';

export class DuplicateSupportError extends Error {
  constructor(public readonly existingResourceId: string) {
    super('Ce fichier existe déjà dans la bibliothèque.');
    this.name = 'DuplicateSupportError';
  }
}

export async function createSubject(name: string, parentId: string | null = null): Promise<SubjectRecord> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Le nom de la matière est obligatoire.');
  const duplicate = await db.subjects.where('name').equalsIgnoreCase(cleanName).first();
  if (duplicate && duplicate.parentId === parentId) throw new Error('Une matière portant ce nom existe déjà.');

  const now = isoNow();
  const subject: SubjectRecord = {
    id: newId(), name: cleanName, parentId, createdAt: now, updatedAt: now, syncState: 'pending', syncError: null,
  };
  await db.transaction('rw', db.subjects, db.outbox, async () => {
    await db.subjects.add(subject);
    await db.outbox.add({ id: newId(), type: 'subject.upsert', entityId: subject.id, attempts: 0, nextAttemptAt: Date.now(), lastError: null, createdAt: now });
  });
  return subject;
}

export async function importFile(
  subjectId: string,
  file: File,
  preferredTitle?: string,
  onProgress?: (progress: TransferProgress) => void,
): Promise<ResourceRecord> {
  await requireSubject(subjectId);
  if (file.size > MAX_RESOURCE_FILE_BYTES) throw new Error('Ce fichier dépasse la taille maximale acceptée par le stockage R2.');

  const sha256 = await sha256Hex(file, (processedBytes, totalBytes) => {
    onProgress?.({ phase: 'hashing', processedBytes, totalBytes });
  });

  const existingVersion = await db.resourceVersions.where('sha256').equals(sha256).first();
  if (existingVersion) {
    const pendingMultipart = await db.multipartUploads.get(existingVersion.id);
    if (!pendingMultipart) throw new DuplicateSupportError(existingVersion.resourceId);
    const existingResource = await db.resources.get(existingVersion.resourceId);
    if (!existingResource) throw new Error('Le support à reprendre est incomplet dans le stockage local.');
    await requestSync();
    await uploadMultipartResource(existingResource.id, file, onProgress);
    return (await db.resources.get(existingResource.id)) ?? existingResource;
  }

  const now = isoNow();
  const resourceId = newId();
  const versionId = newId();
  const extension = file.name.split('.').pop()?.toLowerCase();
  const kind: ResourceKind = file.type === 'application/pdf' || extension === 'pdf' ? 'pdf' : 'text';
  const title = (preferredTitle?.trim() || file.name.replace(/\.[^/.]+$/, '') || 'Sans titre').slice(0, 240);
  const mimeType = file.type || (kind === 'pdf' ? 'application/pdf' : 'text/plain');

  if (shouldUseMultipartUpload(file.size)) {
    const extraction: ExtractionRecord = {
      versionId,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'LARGE_FILE_EXTRACTION_DEFERRED',
      errorMessage: 'Le fichier volumineux est conservé dans R2 sans être copié intégralement dans la mémoire locale. Son extraction automatique est différée.',
      createdAt: now,
    };
    const multipart: MultipartUploadRecord = {
      versionId,
      resourceId,
      fileName: file.name,
      size: file.size,
      lastModified: file.lastModified,
      sha256,
      uploadId: null,
      partSize: MULTIPART_PART_BYTES,
      parts: [],
      status: 'pending',
      error: null,
      updatedAt: now,
    };
    const resource = await persistImportedResource({
      subjectId, title, kind, fileName: file.name, mimeType, size: file.size, bytes: null, sha256,
      extraction, resourceId, versionId, now, enqueueSync: false, multipart,
    });

    // Ensure a newly created subject reaches D1 before resource registration.
    await requestSync();
    await uploadMultipartResource(resource.id, file, onProgress);
    return (await db.resources.get(resource.id)) ?? resource;
  }

  let extraction: ExtractionRecord;
  try {
    // PDF.js is intentionally lazy-loaded so older Safari can boot without it.
    const { extractDocument } = await import('../lib/pdf');
    const pages = await extractDocument(file);
    const charCount = pages.reduce((total, page) => total + page.text.length, 0);
    extraction = { versionId, status: 'ready', pages, charCount, errorCode: null, errorMessage: null, createdAt: now };
  } catch (error) {
    const extractionError = normalizeExtractionError(error);
    extraction = { versionId, status: 'failed', pages: [], charCount: 0, errorCode: extractionError.code, errorMessage: extractionError.message, createdAt: now };
  }

  const bytes = await readBlobAsArrayBuffer(file);
  return persistImportedResource({
    subjectId, title, kind, fileName: file.name, mimeType, size: file.size, bytes, sha256,
    extraction, resourceId, versionId, now, enqueueSync: true, multipart: null,
  });
}

export async function importPastedText(subjectId: string, title: string, text: string): Promise<ResourceRecord> {
  await requireSubject(subjectId);
  const cleanText = text.trim();
  if (!cleanText) throw new Error('Le texte est vide.');
  const cleanTitle = title.trim() || 'Texte personnel';
  const blob = new Blob([cleanText], { type: 'text/plain;charset=utf-8' });
  const bytes = await readBlobAsArrayBuffer(blob);
  const sha256 = await sha256ArrayBuffer(bytes);
  await requireUniqueSha(sha256);

  const now = isoNow();
  const resourceId = newId();
  const versionId = newId();
  const extraction: ExtractionRecord = {
    versionId, status: 'ready', pages: [{ pageNumber: 1, text: cleanText }], charCount: cleanText.length,
    errorCode: null, errorMessage: null, createdAt: now,
  };
  return persistImportedResource({
    subjectId,
    title: cleanTitle.slice(0, 240),
    kind: 'text',
    fileName: `${safeFileName(cleanTitle)}.txt`,
    mimeType: 'text/plain;charset=utf-8',
    size: blob.size,
    bytes,
    sha256,
    extraction,
    resourceId,
    versionId,
    now,
    enqueueSync: true,
    multipart: null,
  });
}

export async function retrySyncForResource(resourceId: string): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) return;
  const multipart = await db.multipartUploads.get(resource.currentVersionId);
  if (multipart) throw new Error('Pour reprendre ce gros fichier, resélectionnez le même fichier sur l’appareil.');

  const now = isoNow();
  await db.transaction('rw', db.resources, db.resourceVersions, db.outbox, async () => {
    await db.resources.update(resourceId, { syncState: 'pending', syncError: null, updatedAt: now });
    await db.resourceVersions.update(resource.currentVersionId, { syncState: 'pending', syncError: null });
    const existing = await db.outbox.where('entityId').equals(resourceId).and((item) => item.type === 'resource.sync').first();
    if (existing) await db.outbox.update(existing.id, { nextAttemptAt: Date.now(), lastError: null });
    else await db.outbox.add({ id: newId(), type: 'resource.sync', entityId: resourceId, attempts: 0, nextAttemptAt: Date.now(), lastError: null, createdAt: now });
  });
}

async function requireSubject(subjectId: string): Promise<void> {
  const subject = await db.subjects.get(subjectId);
  if (!subject) throw new Error('La matière sélectionnée n’existe plus.');
}

async function requireUniqueSha(sha256: string): Promise<void> {
  const existingVersion = await db.resourceVersions.where('sha256').equals(sha256).first();
  if (existingVersion) throw new DuplicateSupportError(existingVersion.resourceId);
}

function normalizeExtractionError(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object') {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : null;
    const message = 'message' in error && typeof error.message === 'string' ? error.message : null;
    if (code && message) return { code, message };
  }
  return {
    code: 'UNREADABLE_PDF',
    message: 'Le contenu n’a pas pu être extrait sur cet appareil. Le fichier reste conservé et pourra être traité par le serveur.',
  };
}

async function persistImportedResource(input: {
  subjectId: string;
  title: string;
  kind: ResourceKind;
  fileName: string;
  mimeType: string;
  size: number;
  bytes: ArrayBuffer | null;
  sha256: string;
  extraction: ExtractionRecord;
  resourceId: string;
  versionId: string;
  now: string;
  enqueueSync: boolean;
  multipart: MultipartUploadRecord | null;
}): Promise<ResourceRecord> {
  const resource: ResourceRecord = {
    id: input.resourceId,
    subjectId: input.subjectId,
    title: input.title,
    kind: input.kind,
    currentVersionId: input.versionId,
    status: input.extraction.status === 'ready' ? 'ready' : 'failed',
    extractionError: input.extraction.errorMessage,
    createdAt: input.now,
    updatedAt: input.now,
    syncState: 'pending',
    syncError: null,
  };
  const version: ResourceVersionRecord = {
    id: input.versionId,
    resourceId: input.resourceId,
    sha256: input.sha256,
    fileName: input.fileName,
    mimeType: input.mimeType,
    size: input.size,
    bytes: input.bytes,
    createdAt: input.now,
    syncState: 'pending',
    syncError: null,
  };

  await db.transaction('rw', db.resources, db.resourceVersions, db.extractions, db.outbox, db.multipartUploads, async () => {
    await db.resources.add(resource);
    await db.resourceVersions.add(version);
    await db.extractions.add(input.extraction);
    if (input.multipart) await db.multipartUploads.add(input.multipart);
    if (input.enqueueSync) {
      await db.outbox.add({ id: newId(), type: 'resource.sync', entityId: input.resourceId, attempts: 0, nextAttemptAt: Date.now(), lastError: null, createdAt: input.now });
    }
  });
  return resource;
}

function safeFileName(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'texte';
}

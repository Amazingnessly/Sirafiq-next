import { db, type ExtractionRecord, type ResourceRecord, type ResourceVersionRecord, type SubjectRecord } from './db';
import { sha256Hex } from '../lib/hash';
import { isoNow, newId } from '../lib/ids';
import { DocumentExtractionError, extractDocument } from '../lib/pdf';
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
  if (duplicate && duplicate.parentId === parentId) {
    throw new Error('Une matière portant ce nom existe déjà.');
  }

  const now = isoNow();
  const subject: SubjectRecord = {
    id: newId(),
    name: cleanName,
    parentId,
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
    syncError: null,
  };

  await db.transaction('rw', db.subjects, db.outbox, async () => {
    await db.subjects.add(subject);
    await db.outbox.add({
      id: newId(),
      type: 'subject.upsert',
      entityId: subject.id,
      attempts: 0,
      nextAttemptAt: Date.now(),
      lastError: null,
      createdAt: now,
    });
  });
  return subject;
}

export async function importFile(subjectId: string, file: File, preferredTitle?: string): Promise<ResourceRecord> {
  const subject = await db.subjects.get(subjectId);
  if (!subject) throw new Error('La matière sélectionnée n’existe plus.');

  const sha256 = await sha256Hex(file);
  const existingVersion = await db.resourceVersions.where('sha256').equals(sha256).first();
  if (existingVersion) throw new DuplicateSupportError(existingVersion.resourceId);

  const now = isoNow();
  const resourceId = newId();
  const versionId = newId();
  const extension = file.name.split('.').pop()?.toLowerCase();
  const kind: ResourceKind = file.type === 'application/pdf' || extension === 'pdf' ? 'pdf' : 'text';
  const title = (preferredTitle?.trim() || file.name.replace(/\.[^/.]+$/, '') || 'Sans titre').slice(0, 240);

  let extraction: ExtractionRecord;
  try {
    const pages = await extractDocument(file);
    const charCount = pages.reduce((total, page) => total + page.text.length, 0);
    extraction = {
      versionId,
      status: 'ready',
      pages,
      charCount,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
    };
  } catch (error) {
    const extractionError = error instanceof DocumentExtractionError
      ? error
      : new DocumentExtractionError('Le contenu n’a pas pu être extrait.', 'UNREADABLE_PDF');
    extraction = {
      versionId,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: extractionError.code,
      errorMessage: extractionError.message,
      createdAt: now,
    };
  }

  const resource: ResourceRecord = {
    id: resourceId,
    subjectId,
    title,
    kind,
    currentVersionId: versionId,
    status: extraction.status === 'ready' ? 'ready' : 'failed',
    extractionError: extraction.errorMessage,
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
    syncError: null,
  };

  // WebKit/Safari can reject Blob/File structured clones in IndexedDB even
  // when the file itself is valid. Store plain bytes locally instead, then
  // reconstruct a Blob only when the file must be displayed or uploaded.
  const bytes = await file.arrayBuffer();
  const version: ResourceVersionRecord = {
    id: versionId,
    resourceId,
    sha256,
    fileName: file.name,
    mimeType: file.type || (kind === 'pdf' ? 'application/pdf' : 'text/plain'),
    size: file.size,
    bytes,
    createdAt: now,
    syncState: 'pending',
    syncError: null,
  };

  await db.transaction('rw', db.resources, db.resourceVersions, db.extractions, db.outbox, async () => {
    await db.resources.add(resource);
    await db.resourceVersions.add(version);
    await db.extractions.add(extraction);
    await db.outbox.add({
      id: newId(),
      type: 'resource.sync',
      entityId: resourceId,
      attempts: 0,
      nextAttemptAt: Date.now(),
      lastError: null,
      createdAt: now,
    });
  });

  return resource;
}

export async function importPastedText(subjectId: string, title: string, text: string): Promise<ResourceRecord> {
  const cleanText = text.trim();
  if (!cleanText) throw new Error('Le texte est vide.');
  const cleanTitle = title.trim() || 'Texte personnel';
  const file = new File([cleanText], `${safeFileName(cleanTitle)}.txt`, { type: 'text/plain' });
  return importFile(subjectId, file, cleanTitle);
}

export async function retrySyncForResource(resourceId: string): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) return;
  const now = isoNow();
  await db.transaction('rw', db.resources, db.resourceVersions, db.outbox, async () => {
    await db.resources.update(resourceId, { syncState: 'pending', syncError: null, updatedAt: now });
    await db.resourceVersions.update(resource.currentVersionId, { syncState: 'pending', syncError: null });
    const existing = await db.outbox.where('entityId').equals(resourceId).and((item) => item.type === 'resource.sync').first();
    if (existing) {
      await db.outbox.update(existing.id, { nextAttemptAt: Date.now(), lastError: null });
    } else {
      await db.outbox.add({
        id: newId(),
        type: 'resource.sync',
        entityId: resourceId,
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
        createdAt: now,
      });
    }
  });
}

function safeFileName(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'texte';
}

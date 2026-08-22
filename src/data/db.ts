import Dexie, { type EntityTable } from 'dexie';
import type { ExtractedPage, ResourceKind, UploadedPart } from '../shared/contracts';

export type SyncState = 'pending' | 'synced' | 'error';
export type LocalResourceStatus = 'ready' | 'failed';

export interface SubjectRecord {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  syncState: SyncState;
  syncError: string | null;
}

export interface ResourceRecord {
  id: string;
  subjectId: string;
  title: string;
  kind: ResourceKind;
  currentVersionId: string;
  status: LocalResourceStatus;
  extractionError: string | null;
  createdAt: string;
  updatedAt: string;
  syncState: SyncState;
  syncError: string | null;
}

export interface ResourceVersionRecord {
  id: string;
  resourceId: string;
  sha256: string;
  fileName: string;
  mimeType: string;
  size: number;
  bytes: ArrayBuffer | null;
  createdAt: string;
  syncState: SyncState;
  syncError: string | null;
}

export interface ExtractionRecord {
  versionId: string;
  status: 'ready' | 'failed';
  pages: ExtractedPage[];
  charCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface OutboxRecord {
  id: string;
  type: 'subject.upsert' | 'resource.sync';
  entityId: string;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: string;
}

export interface MultipartUploadRecord {
  versionId: string;
  resourceId: string;
  fileName: string;
  size: number;
  lastModified: number;
  sha256: string;
  uploadId: string | null;
  partSize: number;
  parts: UploadedPart[];
  status: 'pending' | 'uploading' | 'error';
  error: string | null;
  updatedAt: string;
}

export class SirafiqDB extends Dexie {
  subjects!: EntityTable<SubjectRecord, 'id'>;
  resources!: EntityTable<ResourceRecord, 'id'>;
  resourceVersions!: EntityTable<ResourceVersionRecord, 'id'>;
  extractions!: EntityTable<ExtractionRecord, 'versionId'>;
  outbox!: EntityTable<OutboxRecord, 'id'>;
  multipartUploads!: EntityTable<MultipartUploadRecord, 'versionId'>;

  constructor() {
    super('sirafiq-next');
    this.version(1).stores({
      subjects: 'id, name, parentId, updatedAt, syncState',
      resources: 'id, subjectId, currentVersionId, updatedAt, status, syncState',
      resourceVersions: 'id, resourceId, &sha256, createdAt, syncState',
      extractions: 'versionId, status, createdAt',
      outbox: 'id, type, entityId, nextAttemptAt, createdAt',
    });
    this.version(2).stores({
      subjects: 'id, name, parentId, updatedAt, syncState',
      resources: 'id, subjectId, currentVersionId, updatedAt, status, syncState',
      resourceVersions: 'id, resourceId, &sha256, createdAt, syncState',
      extractions: 'versionId, status, createdAt',
      outbox: 'id, type, entityId, nextAttemptAt, createdAt',
      multipartUploads: 'versionId, resourceId, status, updatedAt',
    });
  }
}

export const db = new SirafiqDB();

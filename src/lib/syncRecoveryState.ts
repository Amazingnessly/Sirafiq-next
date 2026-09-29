import type { MultipartUploadRecord, OutboxRecord, ResourceRecord, SubjectRecord } from '../data/db';
import { isRetryableOutboxAttempt } from './retryableSync';

export interface SyncRecoveryState {
  recoverableSubjects: SubjectRecord[];
  blockedSubjects: SubjectRecord[];
  recoverableResources: ResourceRecord[];
  blockedResources: ResourceRecord[];
  multipartSessions: MultipartUploadRecord[];
}

/**
 * Keep recovery actions and status labels driven by the same classification.
 * Multipart failures stay on their file-reselection path and are not counted as
 * ordinary retryable resource errors.
 */
export function classifySyncRecoveryState(
  subjectErrors: SubjectRecord[],
  resourceErrors: ResourceRecord[],
  multipartSessions: MultipartUploadRecord[],
  outbox: OutboxRecord[],
): SyncRecoveryState {
  const multipartVersionIds = new Set(multipartSessions.map((session) => session.versionId));
  const subjectOutbox = new Map(
    outbox.filter((item) => item.type === 'subject.upsert').map((item) => [item.entityId, item]),
  );
  const resourceOutbox = new Map(
    outbox.filter((item) => item.type === 'resource.sync').map((item) => [item.entityId, item]),
  );

  const recoverableSubjects: SubjectRecord[] = [];
  const blockedSubjects: SubjectRecord[] = [];
  for (const subject of subjectErrors) {
    const existing = subjectOutbox.get(subject.id);
    (existing?.lastError && !isRetryableOutboxAttempt(existing.nextAttemptAt) ? blockedSubjects : recoverableSubjects).push(subject);
  }

  const recoverableResources: ResourceRecord[] = [];
  const blockedResources: ResourceRecord[] = [];
  for (const resource of resourceErrors) {
    if (multipartVersionIds.has(resource.currentVersionId)) continue;
    const existing = resourceOutbox.get(resource.id);
    (existing?.lastError && !isRetryableOutboxAttempt(existing.nextAttemptAt) ? blockedResources : recoverableResources).push(resource);
  }

  return {
    recoverableSubjects,
    blockedSubjects,
    recoverableResources,
    blockedResources,
    multipartSessions,
  };
}

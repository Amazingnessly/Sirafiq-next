import { db } from '../data/db';
import { isoNow, newId } from './ids';
import { isRetryableOutboxAttempt } from './retryableSync';
import { requestSync } from './sync';

/** Retry one subject only when its failure is recoverable.
 * Missing outbox work is rebuilt, while terminal failures remain untouched.
 */
export async function retrySubjectSyncNow(subjectId: string): Promise<boolean> {
  const subject = await db.subjects.get(subjectId);
  if (!subject || subject.syncState !== 'error') return false;

  const existing = await db.outbox
    .where('entityId')
    .equals(subjectId)
    .and((item) => item.type === 'subject.upsert')
    .first();
  if (existing && !isRetryableOutboxAttempt(existing.nextAttemptAt)) return false;

  const retryAt = Date.now();
  const createdAt = isoNow();
  await db.transaction('rw', db.outbox, db.subjects, async () => {
    if (existing) {
      await db.outbox.update(existing.id, { nextAttemptAt: retryAt, lastError: null });
    } else {
      await db.outbox.add({
        id: newId(),
        type: 'subject.upsert',
        entityId: subject.id,
        attempts: 0,
        nextAttemptAt: retryAt,
        lastError: null,
        createdAt,
      });
    }
    await db.subjects.update(subject.id, { syncState: 'pending', syncError: null });
  });
  await requestSync();
  return true;
}

/** Retry only work that is currently in a recoverable sync error state.
 * Pending work keeps its existing retry schedule, multipart failures remain on
 * their dedicated file-reselection recovery path, terminal failures stay blocked,
 * and a missing outbox entry is rebuilt so recoverable local corruption cannot
 * turn the recovery action into a no-op.
 */
export async function retrySyncErrorsNow(): Promise<void> {
  const [outbox, multipartSessions, subjectErrors, resourceErrors] = await Promise.all([
    db.outbox.toArray(),
    db.multipartUploads.where('status').equals('error').toArray(),
    db.subjects.where('syncState').equals('error').toArray(),
    db.resources.where('syncState').equals('error').toArray(),
  ]);
  const multipartVersionIds = new Set(multipartSessions.map((session) => session.versionId));
  const subjectOutbox = new Map(
    outbox.filter((item) => item.type === 'subject.upsert').map((item) => [item.entityId, item]),
  );
  const resourceOutbox = new Map(
    outbox.filter((item) => item.type === 'resource.sync').map((item) => [item.entityId, item]),
  );
  const recoverableSubjects = subjectErrors.filter((subject) => {
    const existing = subjectOutbox.get(subject.id);
    return !existing || isRetryableOutboxAttempt(existing.nextAttemptAt);
  });
  const recoverableResources = resourceErrors.filter((resource) => {
    if (multipartVersionIds.has(resource.currentVersionId)) return false;
    const existing = resourceOutbox.get(resource.id);
    return !existing || isRetryableOutboxAttempt(existing.nextAttemptAt);
  });
  const retryAt = Date.now();
  const createdAt = isoNow();

  await db.transaction('rw', db.outbox, db.subjects, db.resources, db.resourceVersions, async () => {
    for (const subject of recoverableSubjects) {
      const existing = subjectOutbox.get(subject.id);
      if (existing) {
        await db.outbox.update(existing.id, { nextAttemptAt: retryAt, lastError: null });
      } else {
        await db.outbox.add({
          id: newId(),
          type: 'subject.upsert',
          entityId: subject.id,
          attempts: 0,
          nextAttemptAt: retryAt,
          lastError: null,
          createdAt,
        });
      }
      await db.subjects.update(subject.id, { syncState: 'pending', syncError: null });
    }

    for (const resource of recoverableResources) {
      const existing = resourceOutbox.get(resource.id);
      if (existing) {
        await db.outbox.update(existing.id, { nextAttemptAt: retryAt, lastError: null });
      } else {
        await db.outbox.add({
          id: newId(),
          type: 'resource.sync',
          entityId: resource.id,
          attempts: 0,
          nextAttemptAt: retryAt,
          lastError: null,
          createdAt,
        });
      }
      await db.resources.update(resource.id, { syncState: 'pending', syncError: null });
      await db.resourceVersions.update(resource.currentVersionId, { syncState: 'pending', syncError: null });
    }
  });

  if (recoverableSubjects.length || recoverableResources.length) await requestSync();
}

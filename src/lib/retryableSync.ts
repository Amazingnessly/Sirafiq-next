import { db } from '../data/db';
import { requestSync } from './sync';

export const NEVER_RETRY_AT = Number.MAX_SAFE_INTEGER;

export function isRetryableOutboxAttempt(nextAttemptAt: number): boolean {
  return Number.isFinite(nextAttemptAt) && nextAttemptAt < NEVER_RETRY_AT;
}

export function isTerminalOutboxAttempt(nextAttemptAt: number): boolean {
  return !isRetryableOutboxAttempt(nextAttemptAt);
}

/**
 * Network transitions are stronger evidence than the exponential-backoff timer:
 * if connectivity has just returned, retry transient failures immediately.
 * Permanently blocked items keep their MAX_SAFE_INTEGER sentinel untouched.
 */
export async function retryTransientSyncFailuresNow(): Promise<void> {
  const [queued, multipartSessions] = await Promise.all([
    db.outbox.toArray(),
    db.multipartUploads.toArray(),
  ]);
  const multipartResourceIds = new Set(multipartSessions.map((session) => session.resourceId));
  const residualMultipart = queued.filter(
    (item) => item.type === 'resource.sync' && multipartResourceIds.has(item.entityId),
  );
  const retryable = queued.filter(
    (item) => item.lastError
      && isRetryableOutboxAttempt(item.nextAttemptAt)
      && (item.type !== 'resource.sync' || !multipartResourceIds.has(item.entityId)),
  );
  if (retryable.length === 0 && residualMultipart.length === 0) {
    await requestSync();
    return;
  }

  const now = Date.now();
  await db.transaction('rw', db.outbox, db.subjects, db.resources, db.resourceVersions, async () => {
    for (const item of residualMultipart) {
      await db.outbox.delete(item.id);
    }
    for (const item of retryable) {
      await db.outbox.update(item.id, { nextAttemptAt: now, lastError: null });
      if (item.type === 'subject.upsert') {
        await db.subjects.update(item.entityId, { syncState: 'pending', syncError: null });
        continue;
      }

      const resource = await db.resources.get(item.entityId);
      if (!resource) continue;
      await db.resources.update(resource.id, { syncState: 'pending', syncError: null });
      await db.resourceVersions.update(resource.currentVersionId, { syncState: 'pending', syncError: null });
    }
  });

  // installSyncTriggers also listens for `online` and may already have a sync
  // in flight. Wait for it, then make one fresh pass so the newly-due records
  // cannot be stranded behind the old backoff deadline.
  await requestSync();
  await requestSync();
}

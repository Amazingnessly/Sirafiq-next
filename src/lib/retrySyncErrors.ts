import { db } from '../data/db';
import { requestSync } from './sync';

/** Retry only outbox entries that are currently in a recoverable sync error state.
 * Pending work keeps its existing retry schedule, and multipart failures remain on
 * their dedicated file-reselection recovery path.
 */
export async function retrySyncErrorsNow(): Promise<void> {
  const [outbox, multipartSessions] = await Promise.all([
    db.outbox.toArray(),
    db.multipartUploads.where('status').equals('error').toArray(),
  ]);
  const multipartVersionIds = new Set(multipartSessions.map((session) => session.versionId));
  const now = Date.now();

  await db.transaction('rw', db.outbox, db.subjects, db.resources, db.resourceVersions, async () => {
    for (const item of outbox) {
      if (item.type === 'subject.upsert') {
        const subject = await db.subjects.get(item.entityId);
        if (subject?.syncState !== 'error') continue;
        await db.outbox.update(item.id, { nextAttemptAt: now, lastError: null });
        await db.subjects.update(subject.id, { syncState: 'pending', syncError: null });
        continue;
      }

      const resource = await db.resources.get(item.entityId);
      if (!resource || resource.syncState !== 'error' || multipartVersionIds.has(resource.currentVersionId)) continue;
      await db.outbox.update(item.id, { nextAttemptAt: now, lastError: null });
      await db.resources.update(resource.id, { syncState: 'pending', syncError: null });
      await db.resourceVersions.update(resource.currentVersionId, { syncState: 'pending', syncError: null });
    }
  });

  await requestSync();
}

import { Link } from 'react-router-dom';
import { db } from '../data/db';
import { useDexieQuery } from '../data/useDexieQuery';
import { isTerminalOutboxAttempt } from '../lib/retryableSync';

export function SubjectSyncBlocker() {
  const blocked = useDexieQuery(async () => {
    const [subjects, outbox] = await Promise.all([
      db.subjects.where('syncState').equals('error').toArray(),
      db.outbox.where('type').equals('subject.upsert').toArray(),
    ]);
    const attempts = new Map(outbox.map((item) => [item.entityId, item]));
    return subjects.filter((subject) => {
      const attempt = attempts.get(subject.id);
      return Boolean(attempt && isTerminalOutboxAttempt(attempt.nextAttemptAt));
    });
  }, [], []);

  if (blocked.length === 0) return null;

  const first = blocked[0];
  const label = blocked.length === 1
    ? `Matière bloquée · ${first.name}`
    : `${blocked.length} matières bloquées`;
  const target = blocked.length === 1
    ? `/bibliotheque?subject=${encodeURIComponent(first.id)}`
    : '/bibliotheque';

  return (
    <Link
      className="sync-pill sync-pill--error"
      to={target}
      title={first.syncError ?? 'La synchronisation de cette matière nécessite une vérification.'}
    >
      {label} · Vérifier
    </Link>
  );
}

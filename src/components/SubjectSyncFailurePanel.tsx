import { useState } from 'react';
import type { OutboxRecord, SubjectRecord } from '../data/db';
import { db } from '../data/db';
import { useDexieQuery } from '../data/useDexieQuery';
import { isRetryableOutboxAttempt } from '../lib/retryableSync';
import { retrySubjectSyncNow } from '../lib/retrySyncErrors';

export function SubjectSyncFailurePanel({ subject }: { subject: SubjectRecord }) {
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const attempt = useDexieQuery<OutboxRecord | undefined | null>(
    () => db.outbox.where('entityId').equals(subject.id).and((item) => item.type === 'subject.upsert').first(),
    [subject.id],
    null,
  );
  const attemptLoaded = attempt !== null;
  const retryable = attemptLoaded && (!attempt?.lastError || isRetryableOutboxAttempt(attempt.nextAttemptAt));

  const retry = async () => {
    setRetrying(true);
    setActionError(null);
    try {
      const started = await retrySubjectSyncNow(subject.id);
      if (!started) setActionError('Cette erreur ne peut pas être relancée automatiquement.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'La reprise de synchronisation a échoué.');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section className="panel" role="status" aria-live="polite">
      <p className="eyebrow">Synchronisation de la matière à vérifier</p>
      <h2>{subject.name}</h2>
      <p>{subject.syncError ?? 'La synchronisation de cette matière n’a pas abouti. Son contenu local reste disponible.'}</p>
      {!attemptLoaded ? (
        <p className="muted">Vérification de la possibilité de reprise…</p>
      ) : retryable ? (
        <button type="button" className="button button--secondary" onClick={() => void retry()} disabled={retrying}>
          {retrying ? 'Nouvelle tentative…' : 'Réessayer la synchronisation'}
        </button>
      ) : (
        <p className="muted">Cette erreur est bloquée : une nouvelle tentative automatique ne résoudrait pas le problème.</p>
      )}
      {actionError ? <p className="form-error">{actionError}</p> : null}
    </section>
  );
}

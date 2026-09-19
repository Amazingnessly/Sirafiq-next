import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../data/db';
import { useDexieQuery } from '../data/useDexieQuery';
import { requestSync, retryAllSyncErrorsNow } from '../lib/sync';

export function SyncIndicator() {
  const pending = useDexieQuery(() => db.outbox.count(), [], 0);
  const errors = useDexieQuery(async () => {
    const [resourceErrors, subjectErrors] = await Promise.all([
      db.resources.where('syncState').equals('error').count(),
      db.subjects.where('syncState').equals('error').count(),
    ]);
    return resourceErrors + subjectErrors;
  }, [], 0);
  const multipartErrors = useDexieQuery(
    () => db.multipartUploads.where('status').equals('error').count(),
    [],
    0,
  );
  const retryableErrors = errors;
  const [running, setRunning] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function syncNow() {
    setRunning(true);
    try {
      if (retryableErrors > 0) await retryAllSyncErrorsNow();
      else await requestSync();
    } finally {
      setRunning(false);
    }
  }

  if (!online) {
    const blocked = retryableErrors + multipartErrors;
    const localWork = pending > 0 ? `${pending} en attente` : 'travail local';
    const problemSummary = blocked > 0 ? ` · ${blocked} à reprendre` : '';
    return (
      <div className="sync-pill sync-pill--offline" role="status" aria-live="polite">
        Hors ligne · {localWork}{problemSummary}
      </div>
    );
  }

  if (multipartErrors > 0 && retryableErrors === 0) {
    return (
      <Link className="sync-pill sync-pill--error" to="/bibliotheque">
        {multipartErrors} envoi{multipartErrors > 1 ? 's' : ''} à reprendre · Resélectionner
      </Link>
    );
  }

  if (retryableErrors > 0) {
    return (
      <button className="sync-pill sync-pill--error" onClick={syncNow} disabled={running}>
        {running ? 'Nouvel essai…' : `${retryableErrors} erreur${retryableErrors > 1 ? 's' : ''} · Réessayer`}
      </button>
    );
  }

  if (pending > 0 || running) {
    return (
      <button className="sync-pill" onClick={syncNow} disabled={running}>
        {running ? 'Synchronisation…' : `${pending} en attente · Synchroniser`}
      </button>
    );
  }

  return <div className="sync-pill sync-pill--ok">Enregistré</div>;
}

import { useEffect, useState } from 'react';
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
      if (errors > 0) await retryAllSyncErrorsNow();
      else await requestSync();
    } finally {
      setRunning(false);
    }
  }

  if (!online) {
    return <div className="sync-pill sync-pill--offline" aria-label="Hors ligne">Hors ligne · travail local</div>;
  }

  if (errors > 0) {
    return (
      <button className="sync-pill sync-pill--error" onClick={syncNow} disabled={running}>
        {running ? 'Nouvel essai…' : `${errors} erreur${errors > 1 ? 's' : ''} · Réessayer`}
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

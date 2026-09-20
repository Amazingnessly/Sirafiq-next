import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../data/db';
import { useDexieQuery } from '../data/useDexieQuery';
import { requestSync } from '../lib/sync';
import { retrySyncErrorsNow } from '../lib/retrySyncErrors';
import { classifySyncRecoveryState } from '../lib/syncRecoveryState';

export function SyncIndicator() {
  const pending = useDexieQuery(() => db.outbox.count(), [], 0);
  const syncErrors = useDexieQuery(async () => {
    const [resources, subjects, multipartSessions, outbox] = await Promise.all([
      db.resources.where('syncState').equals('error').toArray(),
      db.subjects.where('syncState').equals('error').toArray(),
      db.multipartUploads.where('status').equals('error').toArray(),
      db.outbox.toArray(),
    ]);
    const recovery = classifySyncRecoveryState(subjects, resources, multipartSessions, outbox);
    return {
      retryable: recovery.recoverableSubjects.length + recovery.recoverableResources.length,
      blocked: recovery.blockedSubjects.length + recovery.blockedResources.length,
      multipart: recovery.multipartSessions.length,
    };
  }, [], { retryable: 0, blocked: 0, multipart: 0 });
  const { retryable: retryableErrors, blocked: blockedErrors, multipart: multipartErrors } = syncErrors;
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
      if (retryableErrors > 0) await retrySyncErrorsNow();
      else await requestSync();
    } finally {
      setRunning(false);
    }
  }

  if (!online) {
    const localWork = pending > 0 ? 'travail local à synchroniser' : 'aucune synchronisation en attente';
    const recoveryStates = [
      retryableErrors > 0 ? `${retryableErrors} à réessayer` : '',
      blockedErrors > 0 ? `${blockedErrors} bloquée${blockedErrors > 1 ? 's' : ''}` : '',
      multipartErrors > 0 ? `${multipartErrors} envoi${multipartErrors > 1 ? 's' : ''} à reprendre` : '',
    ].filter(Boolean);
    const problemSummary = recoveryStates.length > 0 ? ` · ${recoveryStates.join(' · ')}` : '';
    return (
      <div className="sync-pill sync-pill--offline" role="status" aria-live="polite">
        Hors ligne · {localWork}{problemSummary}
      </div>
    );
  }

  if (multipartErrors > 0 && pending > blockedErrors) {
    const queued = pending - blockedErrors;
    return (
      <button className="sync-pill sync-pill--error" onClick={syncNow} disabled={running}>
        {running
          ? 'Synchronisation…'
          : `${queued} en attente · Synchroniser · ${multipartErrors} envoi${multipartErrors > 1 ? 's' : ''} à reprendre${blockedErrors > 0 ? ` · ${blockedErrors} bloquée${blockedErrors > 1 ? 's' : ''}` : ''}`}
      </button>
    );
  }

  if (multipartErrors > 0) {
    return (
      <Link className="sync-pill sync-pill--error" to="/bibliotheque?status=sync-error">
        {multipartErrors} envoi{multipartErrors > 1 ? 's' : ''} à reprendre · Resélectionner
        {retryableErrors > 0 ? ` · ${retryableErrors} autre${retryableErrors > 1 ? 's' : ''} erreur${retryableErrors > 1 ? 's' : ''}` : ''}
        {blockedErrors > 0 ? ` · ${blockedErrors} bloquée${blockedErrors > 1 ? 's' : ''}` : ''}
      </Link>
    );
  }

  if (retryableErrors > 0) {
    return (
      <button className="sync-pill sync-pill--error" onClick={syncNow} disabled={running}>
        {running ? 'Nouvel essai…' : `${retryableErrors} erreur${retryableErrors > 1 ? 's' : ''} · Réessayer${blockedErrors > 0 ? ` · ${blockedErrors} bloquée${blockedErrors > 1 ? 's' : ''}` : ''}`}
      </button>
    );
  }

  if (blockedErrors > 0 && pending > blockedErrors) {
    const queued = pending - blockedErrors;
    return (
      <button className="sync-pill sync-pill--error" onClick={syncNow} disabled={running}>
        {running
          ? 'Synchronisation…'
          : `${queued} en attente · Synchroniser · ${blockedErrors} bloquée${blockedErrors > 1 ? 's' : ''}`}
      </button>
    );
  }

  if (blockedErrors > 0) {
    return (
      <Link className="sync-pill sync-pill--error" to="/bibliotheque?status=sync-error">
        {blockedErrors} erreur{blockedErrors > 1 ? 's' : ''} bloquée{blockedErrors > 1 ? 's' : ''} · Vérifier
      </Link>
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

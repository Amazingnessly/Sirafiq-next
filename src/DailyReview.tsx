import { useEffect, useMemo, useState } from 'react';
import type { Flashcard } from './Flashcards';

type StoredSupport = {
  id: string;
  name: string;
  flashcards?: Flashcard[];
  [key: string]: unknown;
};

type ReviewCard = { supportId: string; supportName: string; card: Flashcard };

type Props = { onClose: () => void; onCountChange?: (count: number) => void };

const DB_NAME = 'sirafiq-next';
const STORE = 'supports';
const DAY = 24 * 60 * 60 * 1000;
const intervals = [0, 1, 3, 7, 14, 30];

function isDue(card: Flashcard) {
  return !card.nextReviewAt || new Date(card.nextReviewAt).getTime() <= Date.now();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadSupports(): Promise<StoredSupport[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as StoredSupport[]);
    request.onerror = () => reject(request.error);
  });
}

async function saveSupport(support: StoredSupport) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(support);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function DailyReview({ onClose, onCountChange }: Props) {
  const [supports, setSupports] = useState<StoredSupport[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('Chargement des révisions…');

  useEffect(() => {
    void loadSupports().then(items => { setSupports(items); setStatus(''); }).catch(() => setStatus('Impossible de charger les révisions locales.'));
  }, []);

  const queue = useMemo<ReviewCard[]>(() => supports.flatMap(support => (support.flashcards ?? []).filter(isDue).map(card => ({ supportId: support.id, supportName: support.name, card }))), [supports]);
  const current = queue[index] ?? null;

  useEffect(() => { onCountChange?.(queue.length); }, [queue.length, onCountChange]);
  useEffect(() => { if (index >= queue.length && queue.length) setIndex(queue.length - 1); }, [index, queue.length]);

  const rate = async (success: boolean) => {
    if (!current) return;
    const now = new Date();
    const nextStage = success ? Math.min(intervals.length - 1, current.card.stage + 1) : 0;
    const nextReview = new Date(now.getTime() + intervals[nextStage] * DAY).toISOString();
    const support = supports.find(item => item.id === current.supportId);
    if (!support) return;
    const flashcards = (support.flashcards ?? []).map(card => card.id === current.card.id ? { ...card, stage: nextStage, lastReviewedAt: now.toISOString(), nextReviewAt: nextReview } : card);
    const updated = { ...support, flashcards };
    setStatus('Enregistrement…');
    try {
      await saveSupport(updated);
      setSupports(items => items.map(item => item.id === updated.id ? updated : item));
      setRevealed(false);
      setStatus('');
    } catch {
      setStatus('Impossible d’enregistrer cette révision.');
    }
  };

  return <section className="daily-overlay" role="dialog" aria-modal="true" aria-label="Révisions du jour">
    <div className="daily-shell">
      <header className="daily-header"><div><p className="eyebrow">SIRĀFIQ · RÉVISIONS</p><h1>Révisions du jour</h1><p>Toutes les cartes arrivées à échéance, réunies au même endroit.</p></div><button type="button" onClick={onClose}>Fermer</button></header>
      {status && <p className="daily-status" role="status">{status}</p>}
      {!current ? <div className="daily-empty"><strong>Tout est à jour</strong><p>Aucune carte n’est due maintenant.</p></div> : <div className="daily-review">
        <div className="daily-meta"><span>{current.supportName}</span><strong>{index + 1} / {queue.length}</strong></div>
        <article className="daily-card" onClick={() => setRevealed(true)}><small>Question</small><h2>{current.card.front}</h2>{revealed ? <div><small>Réponse</small><p>{current.card.back}</p></div> : <button type="button" onClick={() => setRevealed(true)}>Afficher la réponse</button>}</article>
        {revealed && <div className="daily-rating"><button type="button" onClick={() => void rate(false)}>À revoir</button><button type="button" onClick={() => void rate(true)}>Acquis</button></div>}
      </div>}
    </div>
  </section>;
}

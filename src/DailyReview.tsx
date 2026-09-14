import { useEffect, useMemo, useState } from 'react';
import type { Flashcard } from './Flashcards';
import { isReviewDue, scheduleReview } from './spacedRepetition.mjs';
import { listSupportMetadata, patchSupportMetadata } from './storage';

type StoredSupport = {
  id: string;
  name: string;
  flashcards?: Flashcard[];
  [key: string]: unknown;
};

type ReviewCard = { supportId: string; supportName: string; card: Flashcard };

type Props = { onClose: () => void; onCountChange?: (count: number) => void };

async function loadSupports(): Promise<StoredSupport[]> {
  return listSupportMetadata<StoredSupport>();
}

export function DailyReview({ onClose, onCountChange }: Props) {
  const [supports, setSupports] = useState<StoredSupport[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('Chargement des révisions…');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadSupports().then(items => { setSupports(items); setStatus(''); }).catch(() => setStatus('Impossible de charger les révisions locales.'));
  }, []);

  const queue = useMemo<ReviewCard[]>(() => supports.flatMap(support => (support.flashcards ?? []).filter(card => isReviewDue(card)).map(card => ({ supportId: support.id, supportName: support.name, card }))), [supports]);
  const current = queue[index] ?? null;

  useEffect(() => { onCountChange?.(queue.length); }, [queue.length, onCountChange]);
  useEffect(() => { if (index >= queue.length && queue.length) setIndex(queue.length - 1); }, [index, queue.length]);

  const rate = async (success: boolean) => {
    if (!current || saving) return;
    const queueLengthBeforeSave = queue.length;
    const schedule = scheduleReview(current.card.stage, success);
    const support = supports.find(item => item.id === current.supportId);
    if (!support) return;
    const flashcards = (support.flashcards ?? []).map(card => card.id === current.card.id ? { ...card, ...schedule } : card);
    setSaving(true);
    setStatus('Enregistrement…');
    try {
      const updated = await patchSupportMetadata<StoredSupport>(support.id, { flashcards });
      setSupports(items => items.map(item => item.id === updated.id ? updated : item));
      if (!success && queueLengthBeforeSave > 1) setIndex(currentIndex => (currentIndex + 1) % queueLengthBeforeSave);
      setRevealed(false);
      setStatus('');
    } catch {
      setStatus('Impossible d’enregistrer cette révision.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="daily-overlay" role="dialog" aria-modal="true" aria-label="Révisions du jour">
    <div className="daily-shell">
      <header className="daily-header"><div><p className="eyebrow">SIRĀFIQ · RÉVISIONS</p><h1>Révisions du jour</h1><p>Toutes les cartes arrivées à échéance, réunies au même endroit.</p></div><button type="button" onClick={onClose}>Fermer</button></header>
      {status && <p className="daily-status" role="status">{status}</p>}
      {!current ? <div className="daily-empty"><strong>Tout est à jour</strong><p>Aucune carte n’est due maintenant.</p></div> : <div className="daily-review">
        <div className="daily-meta"><span>{current.supportName}</span><strong>{index + 1} / {queue.length}</strong></div>
        <article className="daily-card" onClick={() => !saving && setRevealed(true)}><small>Question</small><h2>{current.card.front}</h2>{revealed ? <div><small>Réponse</small><p>{current.card.back}</p></div> : <button type="button" disabled={saving} onClick={() => setRevealed(true)}>Afficher la réponse</button>}</article>
        {revealed && <div className="daily-rating"><button type="button" disabled={saving} onClick={() => void rate(false)}>À revoir</button><button type="button" disabled={saving} onClick={() => void rate(true)}>Acquis</button></div>}
      </div>}
    </div>
  </section>;
}

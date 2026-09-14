import { useEffect, useMemo, useState } from 'react';
import type { Flashcard } from './Flashcards';
import type { MemoryPassage } from './TextMemorization';
import { isReviewDue, scheduleReview } from './spacedRepetition.mjs';
import { listSupportMetadata, patchSupportMetadata } from './storage';

type StoredSupport = {
  id: string;
  name: string;
  flashcards?: Flashcard[];
  memoryPassages?: MemoryPassage[];
  [key: string]: unknown;
};

type ReviewCard = { kind: 'flashcard'; supportId: string; supportName: string; card: Flashcard };
type ReviewPassage = { kind: 'passage'; supportId: string; supportName: string; passage: MemoryPassage };
type ReviewItem = ReviewCard | ReviewPassage;
type PassagePhase = 'read' | 'recall' | 'check';

type Props = { onClose: () => void; onCountChange?: (count: number) => void };

async function loadSupports(): Promise<StoredSupport[]> {
  return listSupportMetadata<StoredSupport>();
}

export function DailyReview({ onClose, onCountChange }: Props) {
  const [supports, setSupports] = useState<StoredSupport[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [passagePhase, setPassagePhase] = useState<PassagePhase>('read');
  const [recall, setRecall] = useState('');
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('Chargement des révisions…');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadSupports().then(items => { setSupports(items); setStatus(''); }).catch(() => setStatus('Impossible de charger les révisions locales.'));
  }, []);

  const queue = useMemo<ReviewItem[]>(() => supports.flatMap(support => [
    ...(support.flashcards ?? []).filter(card => isReviewDue(card)).map(card => ({ kind: 'flashcard' as const, supportId: support.id, supportName: support.name, card })),
    ...(support.memoryPassages ?? []).filter(passage => isReviewDue(passage)).map(passage => ({ kind: 'passage' as const, supportId: support.id, supportName: support.name, passage })),
  ]), [supports]);
  const current = queue[index] ?? null;
  const currentKey = current ? `${current.kind}:${current.kind === 'flashcard' ? current.card.id : current.passage.id}` : '';

  useEffect(() => { onCountChange?.(queue.length); }, [queue.length, onCountChange]);
  useEffect(() => { if (index >= queue.length && queue.length) setIndex(queue.length - 1); }, [index, queue.length]);
  useEffect(() => {
    setRevealed(false);
    setPassagePhase('read');
    setRecall('');
  }, [currentKey]);

  const rate = async (success: boolean) => {
    if (!current || saving) return;
    const queueLengthBeforeSave = queue.length;
    const support = supports.find(item => item.id === current.supportId);
    if (!support) return;

    setSaving(true);
    setStatus('Enregistrement…');
    try {
      let updated: StoredSupport;
      if (current.kind === 'flashcard') {
        const schedule = scheduleReview(current.card.stage, success);
        const flashcards = (support.flashcards ?? []).map(card => card.id === current.card.id ? { ...card, ...schedule } : card);
        updated = await patchSupportMetadata<StoredSupport>(support.id, { flashcards });
      } else {
        const stage = Number.isFinite(current.passage.stage) ? Math.max(0, Math.trunc(current.passage.stage!)) : 0;
        const schedule = scheduleReview(stage, success);
        const memoryPassages = (support.memoryPassages ?? []).map(passage => passage.id === current.passage.id ? {
          ...passage,
          ...schedule,
          attempts: passage.attempts + 1,
          successes: passage.successes + (success ? 1 : 0),
        } : passage);
        updated = await patchSupportMetadata<StoredSupport>(support.id, { memoryPassages });
      }

      setSupports(items => items.map(item => item.id === updated.id ? updated : item));
      if (!success && queueLengthBeforeSave > 1) setIndex(currentIndex => (currentIndex + 1) % queueLengthBeforeSave);
      setRevealed(false);
      setPassagePhase('read');
      setRecall('');
      setStatus('');
    } catch {
      setStatus('Impossible d’enregistrer cette révision.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="daily-overlay" role="dialog" aria-modal="true" aria-label="Révisions du jour">
    <div className="daily-shell">
      <header className="daily-header"><div><p className="eyebrow">SIRĀFIQ · RÉVISIONS</p><h1>Révisions du jour</h1><p>Les cartes et passages de mémorisation arrivés à échéance, réunis au même endroit.</p></div><button type="button" onClick={onClose}>Fermer</button></header>
      {status && <p className="daily-status" role="status">{status}</p>}
      {!current ? <div className="daily-empty"><strong>Tout est à jour</strong><p>Aucune révision n’est due maintenant.</p></div> : <div className="daily-review">
        <div className="daily-meta"><span>{current.supportName} · {current.kind === 'flashcard' ? 'Carte mémoire' : 'Passage texte'}</span><strong>{index + 1} / {queue.length}</strong></div>
        {current.kind === 'flashcard' ? <>
          <article className="daily-card" onClick={() => !saving && setRevealed(true)}><small>Question</small><h2>{current.card.front}</h2>{revealed ? <div><small>Réponse</small><p>{current.card.back}</p></div> : <button type="button" disabled={saving} onClick={() => setRevealed(true)}>Afficher la réponse</button>}</article>
          {revealed && <div className="daily-rating"><button type="button" disabled={saving} onClick={() => void rate(false)}>À revoir</button><button type="button" disabled={saving} onClick={() => void rate(true)}>Acquis</button></div>}
        </> : <>
          <article className="daily-card daily-passage-card">
            <small>{passagePhase === 'read' ? '1 · Lire attentivement' : passagePhase === 'recall' ? '2 · Restituer sans regarder' : '3 · Comparer après l’effort'}</small>
            <h2>{current.passage.title}</h2>
            {passagePhase === 'read' && <><div className="daily-passage-source">{current.passage.text}</div><button type="button" disabled={saving} onClick={() => setPassagePhase('recall')}>Masquer et restituer</button></>}
            {passagePhase === 'recall' && <><textarea className="daily-passage-recall" value={recall} onChange={event => setRecall(event.target.value)} placeholder="Écris ce que tu restitues de mémoire…" autoFocus /><button type="button" disabled={saving} onClick={() => setPassagePhase('check')}>Comparer avec l’original</button></>}
            {passagePhase === 'check' && <div className="daily-passage-compare"><section><small>Ta restitution</small><p>{recall.trim() || 'Aucune restitution écrite.'}</p></section><section><small>Texte original</small><p>{current.passage.text}</p></section></div>}
          </article>
          {passagePhase === 'check' && <div className="daily-rating"><button type="button" disabled={saving} onClick={() => void rate(false)}>À retravailler</button><button type="button" disabled={saving} onClick={() => void rate(true)}>Restitution satisfaisante</button></div>}
        </>}
      </div>}
    </div>
  </section>;
}

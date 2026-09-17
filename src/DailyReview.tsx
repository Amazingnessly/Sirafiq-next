import { useEffect, useMemo, useState } from 'react';
import type { Flashcard } from './Flashcards';
import type { MemoryPassage } from './TextMemorization';
import type { QuranTarget } from './QuranMemorization';
import { isReviewDue, scheduleReview } from './spacedRepetition.mjs';
import { scheduleQuranReview } from './quranScheduling.mjs';
import { listSupportMetadata, mutateSupportMetadata } from './storage';

type StoredSupport = {
  id: string;
  name: string;
  flashcards?: Flashcard[];
  memoryPassages?: MemoryPassage[];
  quranTargets?: QuranTarget[];
  [key: string]: unknown;
};

type ReviewCard = { kind: 'flashcard'; supportId: string; supportName: string; card: Flashcard };
type ReviewPassage = { kind: 'passage'; supportId: string; supportName: string; passage: MemoryPassage };
type ReviewQuran = { kind: 'quran'; supportId: string; supportName: string; target: QuranTarget };
type ReviewItem = ReviewCard | ReviewPassage | ReviewQuran;
type PassagePhase = 'read' | 'recall' | 'check';
type SessionStats = {
  evaluations: number;
  consolidated: number;
  retries: number;
  flashcard: number;
  passage: number;
  quran: number;
};

type Props = { onClose: () => void; onCountChange?: (count: number) => void };

async function loadSupports(): Promise<StoredSupport[]> {
  return listSupportMetadata<StoredSupport>();
}

function reviewItemId(item: ReviewItem) {
  if (item.kind === 'flashcard') return item.card.id;
  if (item.kind === 'passage') return item.passage.id;
  return item.target.id;
}

function openQuranSource(item: ReviewQuran) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('source', item.supportId);
  if (item.target.page) url.searchParams.set('page', String(item.target.page));
  const opened = window.open(url.toString(), '_blank');
  if (opened) opened.opener = null;
  return Boolean(opened);
}

export function DailyReview({ onClose, onCountChange }: Props) {
  const [supports, setSupports] = useState<StoredSupport[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [passagePhase, setPassagePhase] = useState<PassagePhase>('read');
  const [recall, setRecall] = useState('');
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('Chargement des révisions…');
  const [saving, setSaving] = useState(false);
  const [sessionStats, setSessionStats] = useState<SessionStats>({ evaluations: 0, consolidated: 0, retries: 0, flashcard: 0, passage: 0, quran: 0 });

  useEffect(() => {
    void loadSupports().then(items => { setSupports(items); setStatus(''); }).catch(() => setStatus('Impossible de charger les révisions locales.'));
  }, []);

  const queue = useMemo<ReviewItem[]>(() => supports.flatMap(support => [
    ...(support.flashcards ?? []).filter(card => isReviewDue(card)).map(card => ({ kind: 'flashcard' as const, supportId: support.id, supportName: support.name, card })),
    ...(support.memoryPassages ?? []).filter(passage => isReviewDue(passage)).map(passage => ({ kind: 'passage' as const, supportId: support.id, supportName: support.name, passage })),
    ...(support.quranTargets ?? []).filter(target => isReviewDue(target)).map(target => ({ kind: 'quran' as const, supportId: support.id, supportName: support.name, target })),
  ]), [supports]);
  const current = queue[index] ?? null;
  const currentKey = current ? `${current.kind}:${reviewItemId(current)}` : '';
  const hasSessionSummary = !current && sessionStats.evaluations > 0;

  useEffect(() => { onCountChange?.(queue.length); }, [queue.length, onCountChange]);
  useEffect(() => { if (index >= queue.length && queue.length) setIndex(queue.length - 1); }, [index, queue.length]);
  useEffect(() => {
    setRevealed(false);
    setPassagePhase('read');
    setRecall('');
  }, [currentKey]);

  const rate = async (success: boolean) => {
    if (!current || current.kind === 'quran' || saving) return;
    const queueLengthBeforeSave = queue.length;
    const support = supports.find(item => item.id === current.supportId);
    if (!support) return;

    setSaving(true);
    setStatus('Enregistrement…');
    try {
      let found = false;
      const updated = await mutateSupportMetadata<StoredSupport>(support.id, latest => {
        if (current.kind === 'flashcard') {
          const flashcards = (latest.flashcards ?? []).map(card => {
            if (card.id !== current.card.id) return card;
            found = true;
            const schedule = scheduleReview(card.stage, success);
            return { ...card, ...schedule };
          });
          return found ? { ...latest, flashcards } : latest;
        }

        const memoryPassages = (latest.memoryPassages ?? []).map(passage => {
          if (passage.id !== current.passage.id) return passage;
          found = true;
          const stage = Number.isFinite(passage.stage) ? Math.max(0, Math.trunc(passage.stage!)) : 0;
          const schedule = scheduleReview(stage, success);
          return {
            ...passage,
            ...schedule,
            attempts: passage.attempts + 1,
            successes: passage.successes + (success ? 1 : 0),
          };
        });
        return found ? { ...latest, memoryPassages } : latest;
      });

      setSupports(items => items.map(item => item.id === updated.id ? updated : item));
      if (!found) {
        setStatus('Cet élément de révision n’existe plus dans ce support.');
        return;
      }
      setSessionStats(stats => ({
        ...stats,
        evaluations: stats.evaluations + 1,
        consolidated: stats.consolidated + (success ? 1 : 0),
        retries: stats.retries + (success ? 0 : 1),
        flashcard: stats.flashcard + (current.kind === 'flashcard' ? 1 : 0),
        passage: stats.passage + (current.kind === 'passage' ? 1 : 0),
      }));
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

  const rateQuran = async (assessment: QuranTarget['status']) => {
    if (!current || current.kind !== 'quran' || saving) return;
    const queueLengthBeforeSave = queue.length;
    const support = supports.find(item => item.id === current.supportId);
    if (!support) return;

    setSaving(true);
    setStatus('Enregistrement…');
    try {
      let found = false;
      const updated = await mutateSupportMetadata<StoredSupport>(support.id, latest => {
        const quranTargets = (latest.quranTargets ?? []).map(target => {
          if (target.id !== current.target.id) return target;
          found = true;
          const schedule = scheduleQuranReview(target.stage, assessment);
          return {
            ...target,
            ...schedule,
            status: assessment,
            reviews: target.reviews + 1,
          };
        });
        return found ? { ...latest, quranTargets } : latest;
      });
      setSupports(items => items.map(item => item.id === updated.id ? updated : item));
      if (!found) {
        setStatus('Ce passage Qour’ān n’existe plus dans ce support.');
        return;
      }
      const consolidated = assessment !== 'nouveau';
      setSessionStats(stats => ({
        ...stats,
        evaluations: stats.evaluations + 1,
        consolidated: stats.consolidated + (consolidated ? 1 : 0),
        retries: stats.retries + (consolidated ? 0 : 1),
        quran: stats.quran + 1,
      }));
      if (assessment === 'nouveau' && queueLengthBeforeSave > 1) setIndex(currentIndex => (currentIndex + 1) % queueLengthBeforeSave);
      setStatus('');
    } catch {
      setStatus('Impossible d’enregistrer cette révision.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="daily-overlay" role="dialog" aria-modal="true" aria-label="Révisions du jour">
    <div className="daily-shell">
      <header className="daily-header"><div><p className="eyebrow">SIRĀFIQ · RÉVISIONS</p><h1>Révisions du jour</h1><p>Les cartes, passages de mémorisation et repères Qour’ān arrivés à échéance, réunis au même endroit.</p></div><button type="button" onClick={onClose}>Fermer</button></header>
      {status && <p className="daily-status" role="status">{status}</p>}
      {!current ? hasSessionSummary ? <section className="daily-summary" aria-label="Bilan de la séance">
        <p className="eyebrow">SÉANCE TERMINÉE</p>
        <h2>Les révisions dues sont terminées</h2>
        <p>Aucune révision n’est encore due immédiatement. Voici le bilan de cette séance.</p>
        <div className="daily-summary-stats">
          <article><strong>{sessionStats.consolidated}</strong><span>élément{sessionStats.consolidated > 1 ? 's' : ''} consolidé{sessionStats.consolidated > 1 ? 's' : ''}</span></article>
          <article><strong>{sessionStats.evaluations}</strong><span>évaluation{sessionStats.evaluations > 1 ? 's' : ''} effectuée{sessionStats.evaluations > 1 ? 's' : ''}</span></article>
          <article><strong>{sessionStats.retries}</strong><span>reprise{sessionStats.retries > 1 ? 's' : ''} nécessaire{sessionStats.retries > 1 ? 's' : ''} pendant la séance</span></article>
        </div>
        <div className="daily-summary-types" aria-label="Répartition des évaluations"><span>Cartes · {sessionStats.flashcard}</span><span>Textes · {sessionStats.passage}</span><span>Qour’ān · {sessionStats.quran}</span></div>
        <button className="primary" type="button" onClick={onClose}>Terminer la séance</button>
      </section> : <div className="daily-empty"><strong>Tout est à jour</strong><p>Aucune révision n’est due maintenant.</p></div> : <div className="daily-review">
        <div className="daily-meta"><span>{current.supportName} · {current.kind === 'flashcard' ? 'Carte mémoire' : current.kind === 'passage' ? 'Passage texte' : 'Passage Qour’ān'}</span><strong>{index + 1} / {queue.length}</strong></div>
        {current.kind === 'flashcard' ? <>
          <article className="daily-card" onClick={() => !saving && setRevealed(true)}><small>Question</small><h2>{current.card.front}</h2>{revealed ? <div><small>Réponse</small><p>{current.card.back}</p></div> : <button type="button" disabled={saving} onClick={() => setRevealed(true)}>Afficher la réponse</button>}</article>
          {revealed && <div className="daily-rating"><button type="button" disabled={saving} onClick={() => void rate(false)}>À revoir</button><button type="button" disabled={saving} onClick={() => void rate(true)}>Acquis</button></div>}
        </> : current.kind === 'passage' ? <>
          <article className="daily-card daily-passage-card">
            <small>{passagePhase === 'read' ? '1 · Lire attentivement' : passagePhase === 'recall' ? '2 · Restituer sans regarder' : '3 · Comparer après l’effort'}</small>
            <h2>{current.passage.title}</h2>
            {passagePhase === 'read' && <><div className="daily-passage-source">{current.passage.text}</div><button type="button" disabled={saving} onClick={() => setPassagePhase('recall')}>Masquer et restituer</button></>}
            {passagePhase === 'recall' && <><textarea className="daily-passage-recall" value={recall} onChange={event => setRecall(event.target.value)} placeholder="Écris ce que tu restitues de mémoire…" autoFocus /><button type="button" disabled={saving} onClick={() => setPassagePhase('check')}>Comparer avec l’original</button></>}
            {passagePhase === 'check' && <div className="daily-passage-compare"><section><small>Ta restitution</small><p>{recall.trim() || 'Aucune restitution écrite.'}</p></section><section><small>Texte original</small><p>{current.passage.text}</p></section></div>}
          </article>
          {passagePhase === 'check' && <div className="daily-rating"><button type="button" disabled={saving} onClick={() => void rate(false)}>À retravailler</button><button type="button" disabled={saving} onClick={() => void rate(true)}>Restitution satisfaisante</button></div>}
        </> : <>
          <article className="daily-card daily-quran-card">
            <small>Réviser depuis la source originale</small>
            <h2>{current.target.label}</h2>
            <p>{current.target.page ? `Repère : page ${current.target.page}.` : 'Aucun numéro de page indiqué.'} Ouvre le support, observe le passage, ferme ou détourne la source, récite de mémoire puis compare avant de t’évaluer.</p>
            {current.target.note && <div><small>Repère personnel</small><p>{current.target.note}</p></div>}
            <button type="button" disabled={saving} onClick={() => { if (!openQuranSource(current)) setStatus('Impossible d’ouvrir le support de référence. Autorise les fenêtres contextuelles puis réessaie.'); }}>Ouvrir le support de référence{current.target.page ? ` · p. ${current.target.page}` : ''}</button>
          </article>
          <div className="daily-rating daily-quran-rating"><button type="button" disabled={saving} onClick={() => void rateQuran('nouveau')}>À reprendre</button><button type="button" disabled={saving} onClick={() => void rateQuran('consolidation')}>En consolidation</button><button type="button" disabled={saving} onClick={() => void rateQuran('solide')}>Solide</button></div>
        </>}
      </div>}
    </div>
  </section>;
}

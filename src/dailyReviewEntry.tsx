import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DailyReview } from './DailyReview';
import { ErrorBoundary } from './ErrorBoundary';
import type { Flashcard } from './Flashcards';
import type { MemoryPassage } from './TextMemorization';
import type { QuranTarget } from './QuranMemorization';
import { isReviewDue } from './spacedRepetition.mjs';
import { listSupportMetadata, SUPPORT_METADATA_CHANGED_EVENT } from './storage';
import './daily-review.css';

type StoredSupport = { id: string; flashcards?: Flashcard[]; memoryPassages?: MemoryPassage[]; quranTargets?: QuranTarget[] };

async function countDue(): Promise<number> {
  const supports = await listSupportMetadata<StoredSupport>();
  return supports.reduce((total, support) => total
    + (support.flashcards ?? []).filter(card => isReviewDue(card)).length
    + (support.memoryPassages ?? []).filter(passage => isReviewDue(passage)).length
    + (support.quranTargets ?? []).filter(target => isReviewDue(target)).length, 0);
}

function DailyReviewEntry() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => { void countDue().then(setCount).catch(() => setCount(0)); }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const onMetadataChanged = () => refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener(SUPPORT_METADATA_CHANGED_EVENT, onMetadataChanged);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener(SUPPORT_METADATA_CHANGED_EVENT, onMetadataChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return <>
    <button className="daily-launcher" type="button" onClick={() => { refresh(); setOpen(true); }} aria-label={`Ouvrir les révisions du jour, ${count} élément${count > 1 ? 's' : ''} à revoir`}><span>Réviser</span><strong>{count}</strong></button>
    {open && <DailyReview onClose={() => { setOpen(false); refresh(); }} onCountChange={setCount} />}
  </>;
}

const root = document.getElementById('daily-review-root');
if (root) createRoot(root).render(<React.StrictMode><ErrorBoundary area="les révisions du jour"><DailyReviewEntry /></ErrorBoundary></React.StrictMode>);

import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DailyReview } from './DailyReview';
import type { Flashcard } from './Flashcards';
import './daily-review.css';

type StoredSupport = { flashcards?: Flashcard[] };
const DB_NAME = 'sirafiq-next';
const STORE = 'supports';

function isDue(card: Flashcard) { return !card.nextReviewAt || new Date(card.nextReviewAt).getTime() <= Date.now(); }
function countDue(): Promise<number> { return new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const getAll = request.result.transaction(STORE, 'readonly').objectStore(STORE).getAll(); getAll.onerror = () => reject(getAll.error); getAll.onsuccess = () => resolve((getAll.result as StoredSupport[]).reduce((total, support) => total + (support.flashcards ?? []).filter(isDue).length, 0)); }; }); }

function DailyReviewEntry() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => { void countDue().then(setCount).catch(() => setCount(0)); }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1500);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return <>
    <button className="daily-launcher" type="button" onClick={() => { refresh(); setOpen(true); }} aria-label={`Ouvrir les révisions du jour, ${count} carte${count > 1 ? 's' : ''} à revoir`}><span>Réviser</span><strong>{count}</strong></button>
    {open && <DailyReview onClose={() => { setOpen(false); refresh(); }} onCountChange={setCount} />}
  </>;
}

const root = document.getElementById('daily-review-root');
if (root) createRoot(root).render(<React.StrictMode><DailyReviewEntry /></React.StrictMode>);

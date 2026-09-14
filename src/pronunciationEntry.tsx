import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';
import { PronunciationCourse } from './PronunciationCourse';
import './pronunciation.css';

const STORAGE_KEY = 'sirafiq-pronunciation-progress-v1';
const STORAGE_WARNING = 'Impossible d’enregistrer la progression du cursus sur cet appareil. Elle reste visible pour cette session mais pourrait être perdue en fermant la page.';

type LoadResult = { completed: string[]; warning: string };

function loadProgress(): LoadResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { completed: [], warning: '' };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
      return { completed: [], warning: 'La progression locale du cursus est illisible. Elle n’a pas été écrasée automatiquement.' };
    }
    return { completed: Array.from(new Set(parsed)), warning: '' };
  } catch {
    return { completed: [], warning: 'Impossible de lire la progression locale du cursus. Les données existantes n’ont pas été écrasées.' };
  }
}

function PronunciationEntry() {
  const initialRef = useRef<LoadResult | null>(null);
  if (!initialRef.current) initialRef.current = loadProgress();
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState<string[]>(initialRef.current.completed);
  const [storageWarning, setStorageWarning] = useState(initialRef.current.warning);

  const changeCompleted = useCallback((next: string[]) => {
    setCompleted(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStorageWarning('');
    } catch {
      setStorageWarning(STORAGE_WARNING);
    }
  }, []);

  const refresh = useCallback(() => {
    const loaded = loadProgress();
    if (loaded.warning) {
      setStorageWarning(loaded.warning);
      return;
    }
    setCompleted(loaded.completed);
    setStorageWarning('');
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return <>
    <button className="pronunciation-launcher" type="button" onClick={() => { refresh(); setOpen(true); }} aria-label={`Ouvrir le cursus Lecture et voix, ${completed.length} leçons terminées`}>
      <span>Lecture & voix</span><strong>{completed.length}</strong>
    </button>
    {open && <PronunciationCourse completed={completed} onCompletedChange={changeCompleted} storageWarning={storageWarning} onClose={() => setOpen(false)} />}
  </>;
}

const root = document.getElementById('pronunciation-root');
if (root) createRoot(root).render(<React.StrictMode><ErrorBoundary area="le cursus Lecture et voix"><PronunciationEntry /></ErrorBoundary></React.StrictMode>);

import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';
import { WatchItem, WatchLater } from './WatchLater';
import { validateWatchItems } from './watchLaterData.mjs';
import './watch-later.css';

const STORAGE_KEY = 'sirafiq-watch-later-v1';
const STORAGE_WARNING = 'Impossible d’enregistrer la file « À voir » dans le stockage local. Les modifications restent visibles pour cette session, mais pourraient être perdues si tu fermes la page.';
const STORAGE_INVALID_WARNING = 'La file « À voir » enregistrée localement est illisible ou contient des données invalides. Elle n’a pas été écrasée et les modifications sont temporairement bloquées pour protéger les données existantes.';
const STORAGE_READ_WARNING = 'Impossible de lire la file « À voir » depuis le stockage local. Les données existantes n’ont pas été écrasées et les modifications sont temporairement bloquées.';

type LoadResult = { items: WatchItem[]; error: string; writable: boolean };

function loadItems(): LoadResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [], error: '', writable: true };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { items: [], error: STORAGE_INVALID_WARNING, writable: false };
    }
    const validated = validateWatchItems(parsed);
    return validated.ok
      ? { items: validated.items as WatchItem[], error: '', writable: true }
      : { items: [], error: STORAGE_INVALID_WARNING, writable: false };
  } catch {
    return { items: [], error: STORAGE_READ_WARNING, writable: false };
  }
}

function WatchLaterEntry() {
  const initialRef = useRef<LoadResult | null>(null);
  if (!initialRef.current) initialRef.current = loadItems();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WatchItem[]>(initialRef.current.items);
  const [storageWarning, setStorageWarning] = useState(initialRef.current.error);
  const dirtyRef = useRef(false);
  const storageWritableRef = useRef(initialRef.current.writable);

  const persist = useCallback((nextItems: WatchItem[]) => {
    if (!storageWritableRef.current) {
      setStorageWarning(current => current || STORAGE_READ_WARNING);
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
      dirtyRef.current = false;
      setStorageWarning('');
      return true;
    } catch {
      dirtyRef.current = true;
      setStorageWarning(STORAGE_WARNING);
      return false;
    }
  }, []);

  const changeItems = useCallback((nextItems: WatchItem[]) => {
    if (!storageWritableRef.current) {
      setStorageWarning(current => current || STORAGE_READ_WARNING);
      return;
    }
    dirtyRef.current = true;
    setItems(nextItems);
    persist(nextItems);
  }, [persist]);

  const sync = useCallback(() => {
    const loaded = loadItems();
    if (!loaded.writable) {
      storageWritableRef.current = false;
      setStorageWarning(loaded.error);
      return;
    }

    storageWritableRef.current = true;
    if (dirtyRef.current) {
      persist(items);
      return;
    }
    setItems(loaded.items);
    setStorageWarning('');
  }, [items, persist]);

  React.useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY && !dirtyRef.current) sync(); };
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('pageshow', sync);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync]);

  const pending = items.filter(item => item.status !== 'Terminé').length;
  return <>
    <button className="watch-launcher" type="button" onClick={() => { sync(); setOpen(true); }} aria-label={`Ouvrir la file de visionnage, ${pending} élément${pending > 1 ? 's' : ''} en attente`}>
      <span>À voir</span><strong>{pending}</strong>
    </button>
    {open && <WatchLater items={items} onChange={changeItems} storageWarning={storageWarning} onClose={() => { setOpen(false); sync(); }} />}
  </>;
}

const root = document.getElementById('watch-root');
if (root) createRoot(root).render(<React.StrictMode><ErrorBoundary area="la file À voir"><WatchLaterEntry /></ErrorBoundary></React.StrictMode>);

import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WatchItem, WatchLater } from './WatchLater';
import './watch-later.css';

const STORAGE_KEY = 'sirafiq-watch-later-v1';
const STORAGE_WARNING = 'Impossible d’enregistrer la file « À voir » dans le stockage local. Les modifications restent visibles pour cette session, mais pourraient être perdues si tu fermes la page.';

type LoadResult = { items: WatchItem[]; error: string };

function loadItems(): LoadResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [], error: '' };
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? { items: parsed, error: '' }
      : { items: [], error: 'La file « À voir » enregistrée localement est illisible. Elle n’a pas été écrasée.' };
  } catch {
    return { items: [], error: 'Impossible de lire la file « À voir » depuis le stockage local. Les données existantes n’ont pas été écrasées.' };
  }
}

function WatchLaterEntry() {
  const initialRef = useRef<LoadResult | null>(null);
  if (!initialRef.current) initialRef.current = loadItems();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WatchItem[]>(initialRef.current.items);
  const [storageWarning, setStorageWarning] = useState(initialRef.current.error);
  const dirtyRef = useRef(false);

  const persist = useCallback((nextItems: WatchItem[]) => {
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
    dirtyRef.current = true;
    setItems(nextItems);
    persist(nextItems);
  }, [persist]);

  const sync = useCallback(() => {
    if (dirtyRef.current) {
      persist(items);
      return;
    }
    const loaded = loadItems();
    if (loaded.error) {
      setStorageWarning(loaded.error);
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
if (root) createRoot(root).render(<React.StrictMode><WatchLaterEntry /></React.StrictMode>);

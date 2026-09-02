import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WatchItem, WatchLater } from './WatchLater';
import './watch-later.css';

const STORAGE_KEY = 'sirafiq-watch-later-v1';

function loadItems(): WatchItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function WatchLaterEntry() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WatchItem[]>(loadItems);
  const refresh = useCallback(() => setItems(loadItems()), []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const pending = items.filter(item => item.status !== 'Terminé').length;
  return <>
    <button className="watch-launcher" type="button" onClick={() => { refresh(); setOpen(true); }} aria-label={`Ouvrir la file de visionnage, ${pending} élément${pending > 1 ? 's' : ''} en attente`}>
      <span>À voir</span><strong>{pending}</strong>
    </button>
    {open && <WatchLater items={items} onChange={setItems} onClose={() => { setOpen(false); refresh(); }} />}
  </>;
}

const root = document.getElementById('watch-root');
if (root) createRoot(root).render(<React.StrictMode><WatchLaterEntry /></React.StrictMode>);

import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  return <>
    <button className="watch-launcher" type="button" onClick={() => setOpen(true)} aria-label="Ouvrir la file de visionnage">
      <span>À voir</span><strong>{items.filter(item => item.status !== 'Terminé').length}</strong>
    </button>
    {open && <WatchLater items={items} onChange={setItems} onClose={() => setOpen(false)} />}
  </>;
}

const root = document.getElementById('watch-root');
if (root) createRoot(root).render(<React.StrictMode><WatchLaterEntry /></React.StrictMode>);

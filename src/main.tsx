import React, { ChangeEvent, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Support = {
  id: string;
  name: string;
  type: string;
  size: number;
  importedAt: string;
  dataUrl: string;
};

const DB_NAME = 'sirafiq-next';
const STORE = 'supports';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function listSupports(): Promise<Support[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as Support[]).sort((a, b) => b.importedAt.localeCompare(a.importedAt)));
    request.onerror = () => reject(request.error);
  });
}

async function saveSupport(support: Support) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(support);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteSupport(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',', 2);
  if (!header || payload === undefined) throw new Error('Fichier local illisible.');
  const mime = header.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream';
  const bytes = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

const allowedExtensions = ['pdf', 'txt', 'md', 'doc', 'docx', 'ppt', 'pptx', 'epub'];

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [supports, setSupports] = useState<Support[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => setSupports(await listSupports());
  useEffect(() => { refresh().catch(() => setStatus('Impossible de charger la bibliothèque locale.')); }, []);

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setStatus('Import en cours…');
    try {
      for (const file of files) {
        const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!allowedExtensions.includes(extension)) throw new Error(`Format non pris en charge : ${file.name}`);
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} dépasse la limite de 25 Mo.`);
        const dataUrl = await fileToDataUrl(file);
        await saveSupport({ id: crypto.randomUUID(), name: file.name, type: file.type || extension, size: file.size, importedAt: new Date().toISOString(), dataUrl });
      }
      await refresh();
      setStatus(`${files.length} support${files.length > 1 ? 's' : ''} importé${files.length > 1 ? 's' : ''} avec succès.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Échec de l'import.");
    } finally {
      setBusy(false);
    }
  };

  const openSupport = (support: Support) => {
    try {
      const blob = dataUrlToBlob(support.dataUrl);
      const objectUrl = URL.createObjectURL(blob);
      const opened = window.open(objectUrl, '_blank');
      if (!opened) window.location.assign(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      setStatus("Impossible d'ouvrir ce support. Réimporte-le puis réessaie.");
    }
  };

  const remove = async (id: string) => {
    await deleteSupport(id);
    await refresh();
    setStatus('Support supprimé.');
  };

  return <main className="shell">
    <header className="hero">
      <p className="eyebrow">SIRĀFIQ · RECONSTRUCTION</p>
      <h1>Bibliothèque de savoir</h1>
      <p className="lead">Importe tes supports une fois. Ils restent disponibles dans cette bibliothèque après rechargement.</p>
      <input ref={inputRef} className="file-input" type="file" multiple accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.epub" onChange={importFiles} />
      <button className="primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Import en cours…' : 'Importer un support'}</button>
      {status && <p className="status" role="status">{status}</p>}
    </header>
    <section className="library">
      <div className="section-title"><div><span>Bibliothèque</span><h2>Mes supports</h2></div><strong>{supports.length}</strong></div>
      {supports.length === 0 ? <div className="empty"><h3>Aucun support importé</h3><p>PDF, documents, présentations, EPUB et fichiers texte sont acceptés.</p></div> :
        <div className="grid">{supports.map(support => <article className="card" key={support.id}>
          <div className="file-mark">{support.name.split('.').pop()?.toUpperCase()}</div>
          <div className="card-copy"><h3>{support.name}</h3><p>{(support.size / 1024 / 1024).toFixed(2)} Mo · {new Date(support.importedAt).toLocaleDateString('fr-FR')}</p></div>
          <div className="actions"><button type="button" onClick={() => openSupport(support)}>Ouvrir</button><button type="button" onClick={() => remove(support.id)}>Supprimer</button></div>
        </article>)}</div>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

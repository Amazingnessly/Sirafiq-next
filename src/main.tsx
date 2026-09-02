import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import './styles.css';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type Extraction = { version: number; text: string; pages?: number; extractedAt: string };
type Support = { id: string; name: string; type: string; size: number; importedAt: string; category?: string; blob?: Blob; dataUrl?: string; extraction?: Extraction };
type ReadingState = { support: Support; text: string };
const DB_NAME = 'sirafiq-next';
const STORE = 'supports';
const EXTRACTION_VERSION = 3;
const categories = ['Tous', 'Non classé', 'Qour’ān', 'Textes', 'Cours', 'Références'];
const allowedExtensions = ['pdf', 'txt', 'md', 'doc', 'docx', 'ppt', 'pptx', 'epub'];
const readableExtensions = ['txt', 'md', 'pdf', 'docx'];

function openDb(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function listSupports(): Promise<Support[]> { const db = await openDb(); return new Promise((resolve, reject) => { const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); request.onsuccess = () => resolve((request.result as Support[]).sort((a, b) => b.importedAt.localeCompare(a.importedAt))); request.onerror = () => reject(request.error); }); }
async function saveSupport(support: Support) { const db = await openDb(); return new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(support); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
async function deleteSupport(id: string) { const db = await openDb(); return new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
function dataUrlToBlob(dataUrl: string): Blob { const [header, payload] = dataUrl.split(',', 2); if (!header || payload === undefined) throw new Error('Fichier local illisible.'); const mime = header.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream'; const bytes = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload); const array = new Uint8Array(bytes.length); for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i); return new Blob([array], { type: mime }); }
function supportToBlob(support: Support): Blob { if (support.blob instanceof Blob) return support.blob; if (support.dataUrl) return dataUrlToBlob(support.dataUrl); throw new Error('Fichier local illisible.'); }
function extensionOf(support: Support) { return support.name.split('.').pop()?.toLowerCase() ?? ''; }
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> { if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer(); return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Lecture binaire impossible.')); reader.onerror = () => reject(reader.error ?? new Error('Lecture binaire impossible.')); reader.readAsArrayBuffer(blob); }); }
async function extractDocxText(blob: Blob): Promise<string> { const result = await mammoth.extractRawText({ arrayBuffer: await blobToArrayBuffer(blob) }); return result.value.replace(/\n{3,}/g, '\n\n').trim(); }

function PdfVisualReader({ support, onBack }: { support: Support; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = new Uint8Array(await blobToArrayBuffer(supportToBlob(support)));
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (!cancelled) setDocument(pdf);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'PDF illisible.');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [support]);

  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    let task: pdfjs.RenderTask | null = null;
    const render = async () => {
      setRendering(true);
      setError('');
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(280, Math.min(hostRef.current?.clientWidth ?? window.innerWidth - 24, 980));
        const cssScale = availableWidth / base.width;
        const viewport = page.getViewport({ scale: cssScale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas indisponible.');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        task = page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
        await task.promise;
      } catch (err) {
        if (!cancelled && (err as { name?: string }).name !== 'RenderingCancelledException') setError(err instanceof Error ? err.message : 'Impossible de rendre cette page.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    };
    void render();
    return () => { cancelled = true; task?.cancel(); };
  }, [document, pageNumber]);

  const pages = document?.numPages ?? 0;
  return <main className="shell pdf-shell">
    <div className="pdf-toolbar">
      <button className="back" type="button" onClick={onBack}>← Bibliothèque</button>
      <div className="pdf-nav">
        <button type="button" disabled={!document || pageNumber <= 1 || rendering} onClick={() => setPageNumber(page => Math.max(1, page - 1))}>Précédente</button>
        <strong>{document ? `Page ${pageNumber} / ${pages}` : 'Chargement…'}</strong>
        <button type="button" disabled={!document || pageNumber >= pages || rendering} onClick={() => setPageNumber(page => Math.min(pages, page + 1))}>Suivante</button>
      </div>
    </div>
    <article className="pdf-reader">
      <header><p className="eyebrow">PDF · RENDU VISUEL FIDÈLE</p><h1>{support.name}</h1><p>Chaque page est rendue graphiquement, sans reconstruire le texte arabe.</p></header>
      {error && <p className="pdf-error" role="alert">Lecture impossible : {error}</p>}
      <div className="pdf-canvas-host" ref={hostRef}>{rendering && <div className="pdf-loading">Rendu de la page…</div>}<canvas ref={canvasRef} aria-label={`Page ${pageNumber} du PDF`} /></div>
    </article>
  </main>;
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [supports, setSupports] = useState<Support[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Tous');
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [pdfReading, setPdfReading] = useState<Support | null>(null);
  const refresh = async () => setSupports(await listSupports());
  useEffect(() => { refresh().catch(() => setStatus('Impossible de charger la bibliothèque locale.')); }, []);
  const visibleSupports = useMemo(() => { const q = query.trim().toLocaleLowerCase('fr'); return supports.filter((support) => (category === 'Tous' || (support.category || 'Non classé') === category) && (!q || support.name.toLocaleLowerCase('fr').includes(q))); }, [supports, query, category]);

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (!files.length) return; setBusy(true); setStatus('Import en cours…'); try { for (const file of files) { const extension = file.name.split('.').pop()?.toLowerCase() ?? ''; if (!allowedExtensions.includes(extension)) throw new Error(`Format non pris en charge : ${file.name}`); if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} dépasse la limite de 25 Mo.`); await saveSupport({ id: crypto.randomUUID(), name: file.name, type: file.type || extension, size: file.size, importedAt: new Date().toISOString(), category: 'Non classé', blob: new Blob([file], { type: file.type || 'application/octet-stream' }) }); } await refresh(); setStatus(`${files.length} support${files.length > 1 ? 's' : ''} importé${files.length > 1 ? 's' : ''} avec succès.`); } catch (error) { setStatus(error instanceof Error ? error.message : "Échec de l'import."); } finally { setBusy(false); } };
  const openSupport = (support: Support) => { try { const objectUrl = URL.createObjectURL(supportToBlob(support)); const opened = window.open(objectUrl, '_blank'); if (!opened) window.location.assign(objectUrl); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000); } catch { setStatus("Impossible d'ouvrir ce support. Réimporte-le puis réessaie."); } };
  const readSupport = async (support: Support) => { const extension = extensionOf(support); if (extension === 'pdf') { setPdfReading(support); setStatus(''); return; } if (!readableExtensions.includes(extension)) { openSupport(support); return; } if (support.extraction?.version === EXTRACTION_VERSION && extension === 'docx') { setReading({ support, text: support.extraction.text }); setStatus(''); return; } setBusy(true); setStatus(extension === 'docx' ? 'Extraction du texte du document Word…' : 'Lecture du support…'); try { const blob = supportToBlob(support); if (extension === 'docx') { const text = await extractDocxText(blob); if (!text) throw new Error('Aucun texte exploitable détecté dans ce document DOCX.'); const extraction: Extraction = { version: EXTRACTION_VERSION, text, extractedAt: new Date().toISOString() }; const next = { ...support, extraction }; await saveSupport(next); await refresh(); setReading({ support: next, text }); } else { setReading({ support, text: await blob.text() }); } setStatus(''); } catch (error) { console.error(error); setStatus(error instanceof Error ? `Lecture impossible : ${error.message}` : 'Impossible de lire ce support.'); } finally { setBusy(false); } };
  const classify = async (support: Support, nextCategory: string) => { await saveSupport({ ...support, category: nextCategory }); await refresh(); setStatus(`Support classé dans « ${nextCategory} ».`); };
  const remove = async (id: string) => { await deleteSupport(id); await refresh(); if (reading?.support.id === id) setReading(null); if (pdfReading?.id === id) setPdfReading(null); setStatus('Support supprimé.'); };

  if (pdfReading) return <PdfVisualReader support={pdfReading} onBack={() => setPdfReading(null)} />;
  if (reading) return <main className="shell reader-shell"><button className="back" type="button" onClick={() => setReading(null)}>← Bibliothèque</button><article className="reader"><p className="eyebrow">{reading.support.category || 'Non classé'} · {extensionOf(reading.support).toUpperCase()}</p><h1>{reading.support.name}</h1><div className="reader-meta">{(reading.support.size / 1024).toFixed(0)} Ko · importé le {new Date(reading.support.importedAt).toLocaleDateString('fr-FR')}</div><pre className="reader-text">{reading.text}</pre></article></main>;

  return <main className="shell"><header className="hero"><p className="eyebrow">SIRĀFIQ · BIBLIOTHÈQUE</p><h1>Bibliothèque de savoir</h1><p className="lead">Importe, retrouve et classe tes supports. Les documents restent enregistrés localement sur cet appareil.</p><input ref={inputRef} className="file-input" type="file" multiple accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.epub" onChange={importFiles} /><button className="primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Traitement en cours…' : 'Importer un support'}</button>{status && <p className="status" role="status">{status}</p>}</header><section className="library"><div className="section-title"><div><span>Bibliothèque</span><h2>Mes supports</h2></div><strong>{supports.length}</strong></div>{supports.length > 0 && <div className="library-tools"><label className="search"><span>Rechercher</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom du support…" /></label><div className="filters" aria-label="Filtrer par espace">{categories.map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div></div>}{supports.length === 0 ? <div className="empty"><h3>Aucun support importé</h3><p>PDF, documents, présentations, EPUB et fichiers texte sont acceptés.</p></div> : visibleSupports.length === 0 ? <div className="empty"><h3>Aucun résultat</h3><p>Modifie la recherche ou le filtre sélectionné.</p></div> : <div className="grid">{visibleSupports.map(support => <article className="card" key={support.id}><div className="file-mark">{extensionOf(support).toUpperCase()}</div><div className="card-copy"><div className="category-tag">{support.category || 'Non classé'}</div><h3>{support.name}</h3><p>{(support.size / 1024 / 1024).toFixed(2)} Mo · {new Date(support.importedAt).toLocaleDateString('fr-FR')}{extensionOf(support) === 'docx' && support.extraction?.version === EXTRACTION_VERSION ? ' · texte préparé' : ''}</p></div><div className="card-controls"><select aria-label={`Classer ${support.name}`} value={support.category || 'Non classé'} onChange={(event) => classify(support, event.target.value)}>{categories.filter(item => item !== 'Tous').map(item => <option key={item}>{item}</option>)}</select><div className="actions"><button type="button" disabled={busy} onClick={() => readSupport(support)}>{readableExtensions.includes(extensionOf(support)) ? 'Lire' : 'Ouvrir'}</button><button type="button" disabled={busy} onClick={() => remove(support.id)}>Supprimer</button></div></div></article>)}</div>}</section></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

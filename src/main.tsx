import React, { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as mammoth from 'mammoth';
import { Flashcard, Flashcards } from './Flashcards';
import { PdfPageNote, PdfVisualReader } from './PdfVisualReader';
import './styles.css';

type Extraction = { version: number; text: string; pages?: number; extractedAt: string };
type PdfProgress = { page: number; zoom: number; updatedAt: string };
type Support = { id: string; name: string; type: string; size: number; importedAt: string; category?: string; blob?: Blob; dataUrl?: string; extraction?: Extraction; pdfProgress?: PdfProgress; pdfBookmarks?: number[]; pdfNotes?: PdfPageNote[]; flashcards?: Flashcard[] };
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

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [supports, setSupports] = useState<Support[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Tous');
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [pdfReading, setPdfReading] = useState<Support | null>(null);
  const [flashSupport, setFlashSupport] = useState<Support | null>(null);
  const refresh = async () => setSupports(await listSupports());
  useEffect(() => { refresh().catch(() => setStatus('Impossible de charger la bibliothèque locale.')); }, []);
  const visibleSupports = useMemo(() => { const q = query.trim().toLocaleLowerCase('fr'); return supports.filter((support) => (category === 'Tous' || (support.category || 'Non classé') === category) && (!q || support.name.toLocaleLowerCase('fr').includes(q))); }, [supports, query, category]);

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (!files.length) return; setBusy(true); setStatus('Import en cours…'); try { for (const file of files) { const extension = file.name.split('.').pop()?.toLowerCase() ?? ''; if (!allowedExtensions.includes(extension)) throw new Error(`Format non pris en charge : ${file.name}`); if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} dépasse la limite de 25 Mo.`); await saveSupport({ id: crypto.randomUUID(), name: file.name, type: file.type || extension, size: file.size, importedAt: new Date().toISOString(), category: 'Non classé', blob: new Blob([file], { type: file.type || 'application/octet-stream' }) }); } await refresh(); setStatus(`${files.length} support${files.length > 1 ? 's' : ''} importé${files.length > 1 ? 's' : ''} avec succès.`); } catch (error) { setStatus(error instanceof Error ? error.message : "Échec de l'import."); } finally { setBusy(false); } };
  const openSupport = (support: Support) => { try { const objectUrl = URL.createObjectURL(supportToBlob(support)); const opened = window.open(objectUrl, '_blank'); if (!opened) window.location.assign(objectUrl); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000); } catch { setStatus("Impossible d'ouvrir ce support. Réimporte-le puis réessaie."); } };
  const readSupport = async (support: Support) => { const extension = extensionOf(support); if (extension === 'pdf') { setPdfReading(support); setStatus(''); return; } if (!readableExtensions.includes(extension)) { openSupport(support); return; } if (support.extraction?.version === EXTRACTION_VERSION && extension === 'docx') { setReading({ support, text: support.extraction.text }); setStatus(''); return; } setBusy(true); setStatus(extension === 'docx' ? 'Extraction du texte du document Word…' : 'Lecture du support…'); try { const blob = supportToBlob(support); if (extension === 'docx') { const text = await extractDocxText(blob); if (!text) throw new Error('Aucun texte exploitable détecté dans ce document DOCX.'); const extraction: Extraction = { version: EXTRACTION_VERSION, text, extractedAt: new Date().toISOString() }; const next = { ...support, extraction }; await saveSupport(next); await refresh(); setReading({ support: next, text }); } else { setReading({ support, text: await blob.text() }); } setStatus(''); } catch (error) { console.error(error); setStatus(error instanceof Error ? `Lecture impossible : ${error.message}` : 'Impossible de lire ce support.'); } finally { setBusy(false); } };
  const classify = async (support: Support, nextCategory: string) => { await saveSupport({ ...support, category: nextCategory }); await refresh(); setStatus(`Support classé dans « ${nextCategory} ».`); };
  const remove = async (id: string) => { await deleteSupport(id); await refresh(); if (reading?.support.id === id) setReading(null); if (pdfReading?.id === id) setPdfReading(null); if (flashSupport?.id === id) setFlashSupport(null); setStatus('Support supprimé.'); };
  const updateStoredSupport = useCallback((current: Support, patch: Partial<Support>, setCurrent?: (next: Support) => void) => {
    const next: Support = { ...current, ...patch };
    setCurrent?.(next);
    void saveSupport(next).then(() => setSupports(items => items.map(item => item.id === next.id ? next : item))).catch(() => setStatus('Impossible de mémoriser les données locales.'));
  }, []);
  const persistPdfPatch = useCallback((patch: Partial<Support>) => {
    setPdfReading(current => {
      if (!current) return current;
      const next: Support = { ...current, ...patch };
      void saveSupport(next).then(() => setSupports(items => items.map(item => item.id === next.id ? next : item))).catch(() => setStatus('Impossible de mémoriser les données de lecture.'));
      return next;
    });
  }, []);
  const savePdfProgress = useCallback((page: number, zoom: number) => {
    setPdfReading(current => {
      if (!current) return current;
      if (current.pdfProgress?.page === page && current.pdfProgress?.zoom === zoom) return current;
      const next: Support = { ...current, pdfProgress: { page, zoom, updatedAt: new Date().toISOString() } };
      void saveSupport(next).then(() => setSupports(items => items.map(item => item.id === next.id ? next : item))).catch(() => setStatus('Impossible de mémoriser la progression de lecture.'));
      return next;
    });
  }, []);
  const savePdfBookmarks = useCallback((pages: number[]) => persistPdfPatch({ pdfBookmarks: pages }), [persistPdfPatch]);
  const savePdfNotes = useCallback((notes: PdfPageNote[]) => persistPdfPatch({ pdfNotes: notes }), [persistPdfPatch]);
  const saveFlashcards = useCallback((cards: Flashcard[]) => {
    setFlashSupport(current => {
      if (!current) return current;
      const next: Support = { ...current, flashcards: cards };
      updateStoredSupport(current, { flashcards: cards });
      return next;
    });
  }, [updateStoredSupport]);

  if (flashSupport) return <Flashcards supportName={flashSupport.name} cards={flashSupport.flashcards ?? []} onChange={saveFlashcards} onBack={() => setFlashSupport(null)} />;
  if (pdfReading) return <PdfVisualReader name={pdfReading.name} blob={supportToBlob(pdfReading)} initialPage={pdfReading.pdfProgress?.page} initialZoom={pdfReading.pdfProgress?.zoom} bookmarks={pdfReading.pdfBookmarks} notes={pdfReading.pdfNotes} onBack={() => setPdfReading(null)} onProgress={savePdfProgress} onBookmarksChange={savePdfBookmarks} onNotesChange={savePdfNotes} />;
  if (reading) return <main className="shell reader-shell"><button className="back" type="button" onClick={() => setReading(null)}>← Bibliothèque</button><article className="reader"><p className="eyebrow">{reading.support.category || 'Non classé'} · {extensionOf(reading.support).toUpperCase()}</p><h1>{reading.support.name}</h1><div className="reader-meta">{(reading.support.size / 1024).toFixed(0)} Ko · importé le {new Date(reading.support.importedAt).toLocaleDateString('fr-FR')}</div><pre className="reader-text">{reading.text}</pre></article></main>;

  return <main className="shell"><header className="hero"><p className="eyebrow">SIRĀFIQ · BIBLIOTHÈQUE</p><h1>Bibliothèque de savoir</h1><p className="lead">Importe, retrouve et classe tes supports. Les documents restent enregistrés localement sur cet appareil.</p><input ref={inputRef} className="file-input" type="file" multiple accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.epub" onChange={importFiles} /><button className="primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Traitement en cours…' : 'Importer un support'}</button>{status && <p className="status" role="status">{status}</p>}</header><section className="library"><div className="section-title"><div><span>Bibliothèque</span><h2>Mes supports</h2></div><strong>{supports.length}</strong></div>{supports.length > 0 && <div className="library-tools"><label className="search"><span>Rechercher</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom du support…" /></label><div className="filters" aria-label="Filtrer par espace">{categories.map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div></div>}{supports.length === 0 ? <div className="empty"><h3>Aucun support importé</h3><p>PDF, documents, présentations, EPUB et fichiers texte sont acceptés.</p></div> : visibleSupports.length === 0 ? <div className="empty"><h3>Aucun résultat</h3><p>Modifie la recherche ou le filtre sélectionné.</p></div> : <div className="grid">{visibleSupports.map(support => <article className="card" key={support.id}><div className="file-mark">{extensionOf(support).toUpperCase()}</div><div className="card-copy"><div className="category-tag">{support.category || 'Non classé'}</div><h3>{support.name}</h3><p>{(support.size / 1024 / 1024).toFixed(2)} Mo · {new Date(support.importedAt).toLocaleDateString('fr-FR')}{extensionOf(support) === 'pdf' && support.pdfProgress ? ` · reprise p. ${support.pdfProgress.page}` : ''}{extensionOf(support) === 'pdf' && support.pdfBookmarks?.length ? ` · ${support.pdfBookmarks.length} repère${support.pdfBookmarks.length > 1 ? 's' : ''}` : ''}{extensionOf(support) === 'pdf' && support.pdfNotes?.length ? ` · ${support.pdfNotes.length} note${support.pdfNotes.length > 1 ? 's' : ''}` : ''}{support.flashcards?.length ? ` · ${support.flashcards.length} carte${support.flashcards.length > 1 ? 's' : ''}` : ''}{extensionOf(support) === 'docx' && support.extraction?.version === EXTRACTION_VERSION ? ' · texte préparé' : ''}</p></div><div className="card-controls"><select aria-label={`Classer ${support.name}`} value={support.category || 'Non classé'} onChange={(event) => classify(support, event.target.value)}>{categories.filter(item => item !== 'Tous').map(item => <option key={item}>{item}</option>)}</select><div className="actions"><button type="button" disabled={busy} onClick={() => readSupport(support)}>{readableExtensions.includes(extensionOf(support)) ? 'Lire' : 'Ouvrir'}</button><button type="button" disabled={busy} onClick={() => setFlashSupport(support)}>Cartes</button><button type="button" disabled={busy} onClick={() => remove(support.id)}>Supprimer</button></div></div></article>)}</div>}</section></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

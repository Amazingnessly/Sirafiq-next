import React, { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as mammoth from 'mammoth';
import { Flashcard, Flashcards } from './Flashcards';
import { PdfPageNote, PdfVisualReader, type PdfByteSource } from './PdfVisualReader';
import { RecallAttempt, RecallBoard } from './RecallBoard';
import { SupportHub } from './SupportHub';
import { blobToArrayBuffer, createSupportByteSource, deleteSupportRecord, listSupportMetadata, loadSupportBlob, patchSupportMetadata, saveNewSupportFile, SUPPORT_METADATA_CHANGED_EVENT, type SupportMetadataChange } from './storage';
import './styles.css';

type Extraction = { version: number; text: string; pages?: number; extractedAt: string };
type PdfProgress = { page: number; zoom: number; updatedAt: string };
type Support = {
  id: string;
  name: string;
  type: string;
  size: number;
  importedAt: string;
  sourceLastModified?: number;
  category?: string;
  extraction?: Extraction;
  pdfProgress?: PdfProgress;
  pdfBookmarks?: number[];
  pdfNotes?: PdfPageNote[];
  flashcards?: Flashcard[];
  recallDraft?: string;
  recallAttempts?: RecallAttempt[];
};
type ReadingState = { support: Support; text: string };
type PdfReadingState = { support: Support; source: PdfByteSource };
type SupportPatch = Partial<Omit<Support, 'id'>>;
type ImportProgress = { fileName: string; fileIndex: number; totalFiles: number; percent: number };

const EXTRACTION_VERSION = 3;
const MAX_IMPORT_BYTES = 500 * 1024 * 1024;
const STORAGE_MARGIN_BYTES = 20 * 1024 * 1024;
const categories = ['Tous', 'Non classé', 'Qour’ān', 'Textes', 'Cours', 'Références'];
const allowedExtensions = ['pdf', 'txt', 'md', 'doc', 'docx', 'ppt', 'pptx', 'epub'];
const readableExtensions = ['txt', 'md', 'pdf', 'docx'];

async function listSupports(): Promise<Support[]> {
  const supports = await listSupportMetadata<Support>();
  return supports.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

async function deleteSupport(id: string) {
  await deleteSupportRecord(id);
}

function extensionOf(support: Support) {
  return support.name.split('.').pop()?.toLowerCase() ?? '';
}

function sourceSignature(name: string, size: number, lastModified: number) {
  return `${name}\u0000${size}\u0000${lastModified}`;
}

async function extractDocxText(blob: Blob): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: await blobToArrayBuffer(blob) });
  return result.value.replace(/\n{3,}/g, '\n\n').trim();
}

async function ensureStorageCapacity(bytes: number) {
  if (!navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  if (estimate.quota === undefined || estimate.usage === undefined) return;
  const available = Math.max(0, estimate.quota - estimate.usage);
  if (available < bytes + STORAGE_MARGIN_BYTES) {
    throw new Error('Espace local insuffisant sur cet appareil pour enregistrer ce support. Libère de l’espace puis réessaie.');
  }
}

function importErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Import annulé.';
  if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) {
    return 'Le navigateur n’a pas assez d’espace local pour ce support. Libère de l’espace sur l’appareil puis réessaie.';
  }
  return error instanceof Error ? error.message : "Échec de l'import.";
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const [supports, setSupports] = useState<Support[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Tous');
  const [hubSupport, setHubSupport] = useState<Support | null>(null);
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [pdfReading, setPdfReading] = useState<PdfReadingState | null>(null);
  const [flashSupport, setFlashSupport] = useState<Support | null>(null);
  const [recallSupport, setRecallSupport] = useState<Support | null>(null);

  const refresh = async () => setSupports(await listSupports());

  useEffect(() => {
    refresh().catch(() => setStatus('Impossible de charger la bibliothèque locale.'));
  }, []);

  useEffect(() => {
    const onMetadataChanged = (event: Event) => {
      const detail = (event as CustomEvent<SupportMetadataChange>).detail;
      if (!detail?.id) return;

      if (detail.deleted) {
        setSupports(items => items.filter(item => item.id !== detail.id));
        setHubSupport(current => current?.id === detail.id ? null : current);
        setFlashSupport(current => current?.id === detail.id ? null : current);
        setRecallSupport(current => current?.id === detail.id ? null : current);
        setReading(current => current?.support.id === detail.id ? null : current);
        setPdfReading(current => current?.support.id === detail.id ? null : current);
        return;
      }

      if (!detail.metadata) return;
      const metadata = detail.metadata as Support;
      setSupports(items => {
        const next = items.some(item => item.id === metadata.id)
          ? items.map(item => item.id === metadata.id ? { ...item, ...metadata } : item)
          : [metadata, ...items];
        return next.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
      });
      const mergeSupport = (current: Support | null) => current?.id === metadata.id ? { ...current, ...metadata } : current;
      setHubSupport(mergeSupport);
      setFlashSupport(mergeSupport);
      setRecallSupport(mergeSupport);
      setReading(current => current?.support.id === metadata.id ? { ...current, support: { ...current.support, ...metadata } } : current);
      setPdfReading(current => current?.support.id === metadata.id ? { ...current, support: { ...current.support, ...metadata } } : current);
    };

    window.addEventListener(SUPPORT_METADATA_CHANGED_EVENT, onMetadataChanged);
    return () => window.removeEventListener(SUPPORT_METADATA_CHANGED_EVENT, onMetadataChanged);
  }, []);

  const visibleSupports = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('fr');
    return supports.filter((support) =>
      (category === 'Tous' || (support.category || 'Non classé') === category)
      && (!q || support.name.toLocaleLowerCase('fr').includes(q))
    );
  }, [supports, query, category]);

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    const controller = new AbortController();
    importAbortRef.current = controller;
    let importedCount = 0;
    let skippedCount = 0;
    let cancelled = false;
    const failedFiles: string[] = [];

    setBusy(true);
    setStatus('Préparation de l’import…');

    try {
      const existingSupports = await listSupports();
      const knownSignatures = new Set(
        existingSupports
          .filter(support => support.sourceLastModified !== undefined)
          .map(support => sourceSignature(support.name, support.size, support.sourceLastModified!))
      );

      for (const [fileIndex, file] of files.entries()) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }

        try {
          const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
          if (!allowedExtensions.includes(extension)) throw new Error(`Format non pris en charge : ${file.name}`);
          if (file.size > MAX_IMPORT_BYTES) throw new Error(`${file.name} dépasse la limite de sécurité de 500 Mo.`);

          const signature = sourceSignature(file.name, file.size, file.lastModified);
          if (knownSignatures.has(signature)) {
            skippedCount += 1;
            setStatus(`${files.length > 1 ? `${fileIndex + 1}/${files.length} · ` : ''}${file.name} est déjà importé · doublon ignoré.`);
            continue;
          }

          await ensureStorageCapacity(file.size);
          setImportProgress({ fileName: file.name, fileIndex, totalFiles: files.length, percent: 0 });
          await saveNewSupportFile({
            id: crypto.randomUUID(),
            name: file.name,
            type: file.type || extension,
            size: file.size,
            importedAt: new Date().toISOString(),
            sourceLastModified: file.lastModified,
            category: 'Non classé',
          }, file, progress => {
            const percent = Math.min(100, Math.max(0, Math.round(progress * 100)));
            setImportProgress({ fileName: file.name, fileIndex, totalFiles: files.length, percent });
            setStatus(`${files.length > 1 ? `${fileIndex + 1}/${files.length} · ` : ''}${file.name} · ${percent} %`);
          }, controller.signal);
          knownSignatures.add(signature);
          importedCount += 1;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            cancelled = true;
            setImportProgress(null);
            setStatus('Annulation de l’import…');
            break;
          }
          failedFiles.push(`${file.name} : ${importErrorMessage(error)}`);
          setImportProgress(null);
          setStatus(`${files.length > 1 ? `${fileIndex + 1}/${files.length} · ` : ''}${file.name} · échec, poursuite du lot…`);
        }
      }

      await refresh();
      const summary = [
        `${importedCount} support${importedCount > 1 ? 's' : ''} importé${importedCount > 1 ? 's' : ''}`,
      ];
      if (skippedCount > 0) summary.push(`${skippedCount} doublon${skippedCount > 1 ? 's' : ''} ignoré${skippedCount > 1 ? 's' : ''}`);
      if (failedFiles.length > 0) summary.push(`${failedFiles.length} échec${failedFiles.length > 1 ? 's' : ''}`);
      if (cancelled) summary.push('import annulé');
      const failureDetail = failedFiles.length === 1
        ? ` ${failedFiles[0]}`
        : failedFiles.length > 1
          ? ` Premier échec : ${failedFiles[0]}`
          : '';
      setStatus(`${summary.join(' · ')}.${failureDetail}`);
    } catch (error) {
      setStatus(importErrorMessage(error));
    } finally {
      importAbortRef.current = null;
      setImportProgress(null);
      setBusy(false);
    }
  };

  const openSupport = async (support: Support) => {
    const blob = await loadSupportBlob(support.id, support.type || 'application/octet-stream');
    const objectUrl = URL.createObjectURL(blob);
    const opened = window.open(objectUrl, '_blank');
    if (!opened) window.location.assign(objectUrl);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  };

  const readSupport = async (support: Support) => {
    const extension = extensionOf(support);

    if (extension === 'pdf') {
      setBusy(true);
      setStatus('Ouverture du PDF…');
      try {
        const source = await createSupportByteSource(support.id, support.type || 'application/pdf');
        setPdfReading({ support, source });
        setStatus('');
      } catch (error) {
        console.error(error);
        setStatus(error instanceof Error ? `Lecture impossible : ${error.message}` : 'Impossible de lire ce support.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!readableExtensions.includes(extension)) {
      setBusy(true);
      setStatus('Ouverture du support…');
      try {
        await openSupport(support);
        setStatus('');
      } catch (error) {
        console.error(error);
        setStatus("Impossible d'ouvrir ce support. Réimporte-le puis réessaie.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (support.extraction?.version === EXTRACTION_VERSION && extension === 'docx') {
      setReading({ support, text: support.extraction.text });
      setStatus('');
      return;
    }

    setBusy(true);
    setStatus(extension === 'docx' ? 'Extraction du texte du document Word…' : 'Lecture du support…');
    try {
      const blob = await loadSupportBlob(support.id, support.type || 'application/octet-stream');
      if (extension === 'docx') {
        const text = await extractDocxText(blob);
        if (!text) throw new Error('Aucun texte exploitable détecté dans ce document DOCX.');
        const extraction: Extraction = { version: EXTRACTION_VERSION, text, extractedAt: new Date().toISOString() };
        const next = await patchSupportMetadata<Support>(support.id, { extraction });
        setSupports(items => items.map(item => item.id === next.id ? next : item));
        setReading({ support: next, text });
      } else {
        setReading({ support, text: await blob.text() });
      }
      setStatus('');
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? `Lecture impossible : ${error.message}` : 'Impossible de lire ce support.');
    } finally {
      setBusy(false);
    }
  };

  const classify = async (support: Support, nextCategory: string) => {
    const next = await patchSupportMetadata<Support>(support.id, { category: nextCategory });
    setSupports(items => items.map(item => item.id === next.id ? next : item));
    setStatus(`Support classé dans « ${nextCategory} ».`);
  };

  const remove = async (id: string) => {
    const support = supports.find(item => item.id === id);
    if (!support || !window.confirm(`Supprimer définitivement « ${support.name} » ?\n\nLe fichier et toutes ses données d’étude (cartes, restitutions, notes, repères et mémorisation) seront supprimés de cet appareil.`)) return;
    await deleteSupport(id);
    await refresh();
    if (hubSupport?.id === id) setHubSupport(null);
    if (reading?.support.id === id) setReading(null);
    if (pdfReading?.support.id === id) setPdfReading(null);
    if (flashSupport?.id === id) setFlashSupport(null);
    if (recallSupport?.id === id) setRecallSupport(null);
    setStatus('Support supprimé.');
  };

  const updateStoredSupport = useCallback((current: Support, patch: SupportPatch) => {
    const next: Support = { ...current, ...patch };
    void patchSupportMetadata<Support>(current.id, patch)
      .then(saved => setSupports(items => items.map(item => item.id === saved.id ? saved : item)))
      .catch(() => setStatus('Impossible de mémoriser les données locales.'));
    return next;
  }, []);

  const persistPdfPatch = useCallback((patch: SupportPatch) => {
    setPdfReading(current => current ? { ...current, support: updateStoredSupport(current.support, patch) } : current);
  }, [updateStoredSupport]);

  const savePdfProgress = useCallback((page: number, zoom: number) => {
    setPdfReading(current => {
      if (!current) return current;
      if (current.support.pdfProgress?.page === page && current.support.pdfProgress?.zoom === zoom) return current;
      return {
        ...current,
        support: updateStoredSupport(current.support, { pdfProgress: { page, zoom, updatedAt: new Date().toISOString() } }),
      };
    });
  }, [updateStoredSupport]);

  const savePdfBookmarks = useCallback((pages: number[]) => persistPdfPatch({ pdfBookmarks: pages }), [persistPdfPatch]);
  const savePdfNotes = useCallback((notes: PdfPageNote[]) => persistPdfPatch({ pdfNotes: notes }), [persistPdfPatch]);
  const saveFlashcards = useCallback((cards: Flashcard[]) => {
    setFlashSupport(current => current ? updateStoredSupport(current, { flashcards: cards }) : current);
  }, [updateStoredSupport]);
  const saveRecallDraft = useCallback((draft: string) => {
    setRecallSupport(current => current ? updateStoredSupport(current, { recallDraft: draft }) : current);
  }, [updateStoredSupport]);
  const saveRecallAttempts = useCallback((attempts: RecallAttempt[]) => {
    setRecallSupport(current => current ? updateStoredSupport(current, { recallAttempts: attempts }) : current);
  }, [updateStoredSupport]);

  if (recallSupport) {
    return <RecallBoard supportName={recallSupport.name} draft={recallSupport.recallDraft} attempts={recallSupport.recallAttempts} onDraftChange={saveRecallDraft} onAttemptsChange={saveRecallAttempts} onBack={() => setRecallSupport(null)} />;
  }

  if (flashSupport) {
    return <Flashcards supportName={flashSupport.name} cards={flashSupport.flashcards ?? []} onChange={saveFlashcards} onBack={() => setFlashSupport(null)} />;
  }

  if (pdfReading) {
    return <PdfVisualReader name={pdfReading.support.name} source={pdfReading.source} initialPage={pdfReading.support.pdfProgress?.page} initialZoom={pdfReading.support.pdfProgress?.zoom} bookmarks={pdfReading.support.pdfBookmarks} notes={pdfReading.support.pdfNotes} onBack={() => setPdfReading(null)} onProgress={savePdfProgress} onBookmarksChange={savePdfBookmarks} onNotesChange={savePdfNotes} />;
  }

  if (reading) {
    return <main className="shell reader-shell"><button className="back" type="button" onClick={() => setReading(null)}>← Bibliothèque</button><article className="reader"><p className="eyebrow">{reading.support.category || 'Non classé'} · {extensionOf(reading.support).toUpperCase()}</p><h1>{reading.support.name}</h1><div className="reader-meta">{(reading.support.size / 1024).toFixed(0)} Ko · importé le {new Date(reading.support.importedAt).toLocaleDateString('fr-FR')}</div><pre className="reader-text">{reading.text}</pre></article></main>;
  }

  if (hubSupport) {
    return <SupportHub id={hubSupport.id} name={hubSupport.name} category={hubSupport.category || 'Non classé'} canRead={readableExtensions.includes(extensionOf(hubSupport))} flashcards={hubSupport.flashcards?.length ?? 0} recallAttempts={hubSupport.recallAttempts?.length ?? 0} pdfBookmarks={hubSupport.pdfBookmarks?.length ?? 0} pdfNotes={hubSupport.pdfNotes?.length ?? 0} onRead={() => { const support = hubSupport; setHubSupport(null); void readSupport(support); }} onFlashcards={() => { setFlashSupport(hubSupport); setHubSupport(null); }} onRecall={() => { setRecallSupport(hubSupport); setHubSupport(null); }} onBack={() => setHubSupport(null)} />;
  }

  return <main className="shell"><header className="hero"><p className="eyebrow">SIRĀFIQ · BIBLIOTHÈQUE</p><h1>Bibliothèque de savoir</h1><p className="lead">Importe, retrouve et classe tes supports. Les documents restent enregistrés localement sur cet appareil.</p><input ref={inputRef} className="file-input" type="file" multiple accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.epub" onChange={importFiles} /><button className="primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Traitement en cours…' : 'Importer un support'}</button>{status && <p className="status" role="status">{status}</p>}{importProgress && <div><progress value={importProgress.percent} max={100} aria-label={`Import de ${importProgress.fileName} : ${importProgress.percent} %`} /><button type="button" onClick={() => importAbortRef.current?.abort()}>Annuler l’import</button></div>}</header><section className="library"><div className="section-title"><div><span>Bibliothèque</span><h2>Mes supports</h2></div><strong>{supports.length}</strong></div>{supports.length > 0 && <div className="library-tools"><label className="search"><span>Rechercher</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom du support…" /></label><div className="filters" aria-label="Filtrer par espace">{categories.map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div></div>}{supports.length === 0 ? <div className="empty"><h3>Aucun support importé</h3><p>PDF, documents, présentations, EPUB et fichiers texte sont acceptés.</p></div> : visibleSupports.length === 0 ? <div className="empty"><h3>Aucun résultat</h3><p>Modifie la recherche ou le filtre sélectionné.</p></div> : <div className="grid">{visibleSupports.map(support => <article className="card" key={support.id}><div className="file-mark">{extensionOf(support).toUpperCase()}</div><div className="card-copy"><div className="category-tag">{support.category || 'Non classé'}</div><h3>{support.name}</h3><p>{(support.size / 1024 / 1024).toFixed(2)} Mo · {new Date(support.importedAt).toLocaleDateString('fr-FR')}{extensionOf(support) === 'pdf' && support.pdfProgress ? ` · reprise p. ${support.pdfProgress.page}` : ''}{extensionOf(support) === 'pdf' && support.pdfBookmarks?.length ? ` · ${support.pdfBookmarks.length} repère${support.pdfBookmarks.length > 1 ? 's' : ''}` : ''}{extensionOf(support) === 'pdf' && support.pdfNotes?.length ? ` · ${support.pdfNotes.length} note${support.pdfNotes.length > 1 ? 's' : ''}` : ''}{support.flashcards?.length ? ` · ${support.flashcards.length} carte${support.flashcards.length > 1 ? 's' : ''}` : ''}{support.recallAttempts?.length ? ` · ${support.recallAttempts.length} restitution${support.recallAttempts.length > 1 ? 's' : ''}` : ''}{extensionOf(support) === 'docx' && support.extraction?.version === EXTRACTION_VERSION ? ' · texte préparé' : ''}</p></div><div className="card-controls"><select aria-label={`Classer ${support.name}`} value={support.category || 'Non classé'} onChange={(event) => classify(support, event.target.value)}>{categories.filter(item => item !== 'Tous').map(item => <option key={item}>{item}</option>)}</select><div className="actions"><button type="button" disabled={busy} onClick={() => setHubSupport(support)}>Étudier</button><button type="button" disabled={busy} onClick={() => remove(support.id)}>Supprimer</button></div></div></article>)}</div>}</section></main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

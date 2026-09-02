import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type PdfPageNote = { page: number; text: string; updatedAt: string };

type Props = {
  name: string;
  blob: Blob;
  initialPage?: number;
  initialZoom?: number;
  bookmarks?: number[];
  notes?: PdfPageNote[];
  onBack: () => void;
  onProgress: (page: number, zoom: number) => void;
  onBookmarksChange: (pages: number[]) => void;
  onNotesChange: (notes: PdfPageNote[]) => void;
};

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Lecture binaire impossible.'));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture binaire impossible.'));
    reader.readAsArrayBuffer(blob);
  });
}

export function PdfVisualReader({ name, blob, initialPage = 1, initialZoom = 1, bookmarks = [], notes = [], onBack, onProgress, onBookmarksChange, onNotesChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage));
  const [zoom, setZoom] = useState(Math.min(1.8, Math.max(.75, initialZoom)));
  const [jumpValue, setJumpValue] = useState(String(Math.max(1, initialPage)));
  const [noteDraft, setNoteDraft] = useState('');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);
  const cleanBookmarks = useMemo(() => Array.from(new Set(bookmarks.filter(page => Number.isInteger(page) && page > 0))).sort((a, b) => a - b), [bookmarks]);
  const cleanNotes = useMemo(() => notes.filter(note => Number.isInteger(note.page) && note.page > 0 && note.text.trim()).sort((a, b) => a.page - b.page), [notes]);
  const isBookmarked = cleanBookmarks.includes(pageNumber);
  const currentNote = cleanNotes.find(note => note.page === pageNumber);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = new Uint8Array(await blobToArrayBuffer(blob));
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (!cancelled) {
          setDocument(pdf);
          setPageNumber(page => Math.min(Math.max(1, page), pdf.numPages));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'PDF illisible.');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [blob]);

  useEffect(() => setJumpValue(String(pageNumber)), [pageNumber]);
  useEffect(() => setNoteDraft(currentNote?.text ?? ''), [pageNumber, currentNote?.text]);

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
        const fitScale = availableWidth / base.width;
        const viewport = page.getViewport({ scale: fitScale * zoom });
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
        if (!cancelled) onProgress(pageNumber, zoom);
      } catch (err) {
        if (!cancelled && (err as { name?: string }).name !== 'RenderingCancelledException') setError(err instanceof Error ? err.message : 'Impossible de rendre cette page.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    };
    void render();
    return () => { cancelled = true; task?.cancel(); };
  }, [document, pageNumber, zoom, onProgress]);

  const pages = document?.numPages ?? 0;
  const goTo = (page: number) => setPageNumber(Math.min(Math.max(1, page), Math.max(1, pages)));
  const submitJump = (event: FormEvent) => {
    event.preventDefault();
    const requested = Number.parseInt(jumpValue, 10);
    if (Number.isFinite(requested)) goTo(requested);
  };
  const toggleBookmark = () => {
    const next = isBookmarked ? cleanBookmarks.filter(page => page !== pageNumber) : [...cleanBookmarks, pageNumber].sort((a, b) => a - b);
    onBookmarksChange(next);
  };
  const saveNote = () => {
    const text = noteDraft.trim();
    const withoutCurrent = cleanNotes.filter(note => note.page !== pageNumber);
    onNotesChange(text ? [...withoutCurrent, { page: pageNumber, text, updatedAt: new Date().toISOString() }].sort((a, b) => a.page - b.page) : withoutCurrent);
  };
  const deleteNote = () => {
    setNoteDraft('');
    onNotesChange(cleanNotes.filter(note => note.page !== pageNumber));
  };

  return <main className="shell pdf-shell">
    <div className="pdf-toolbar">
      <button className="back" type="button" onClick={onBack}>← Bibliothèque</button>
      <div className="pdf-nav">
        <button type="button" disabled={!document || pageNumber <= 1 || rendering} onClick={() => goTo(pageNumber - 1)}>Précédente</button>
        <strong>{document ? `Page ${pageNumber} / ${pages}` : 'Chargement…'}</strong>
        <button type="button" disabled={!document || pageNumber >= pages || rendering} onClick={() => goTo(pageNumber + 1)}>Suivante</button>
      </div>
      <div className="pdf-secondary-controls">
        <form className="pdf-jump" onSubmit={submitJump}>
          <label htmlFor="pdf-page-jump">Aller à</label>
          <input id="pdf-page-jump" inputMode="numeric" pattern="[0-9]*" value={jumpValue} onChange={event => setJumpValue(event.target.value)} aria-label="Numéro de page" />
          <button type="submit" disabled={!document}>OK</button>
        </form>
        <div className="pdf-zoom" aria-label="Zoom du PDF">
          <button type="button" disabled={zoom <= .75 || rendering} onClick={() => setZoom(value => Math.max(.75, Number((value - .25).toFixed(2))))}>−</button>
          <span>{Math.round(zoom * 100)} %</span>
          <button type="button" disabled={zoom >= 1.8 || rendering} onClick={() => setZoom(value => Math.min(1.8, Number((value + .25).toFixed(2))))}>+</button>
        </div>
      </div>
    </div>
    <article className="pdf-reader">
      <header>
        <p className="eyebrow">PDF · RENDU VISUEL FIDÈLE</p><h1>{name}</h1><p>La progression, les repères et les notes de page restent sur cet appareil.</p>
        <div className="pdf-study-tools">
          <button className={isBookmarked ? 'bookmarked' : ''} type="button" onClick={toggleBookmark}>{isBookmarked ? '★ Page repérée' : '☆ Repérer cette page'}</button>
          <details className="pdf-bookmarks">
            <summary>Repères ({cleanBookmarks.length})</summary>
            {cleanBookmarks.length === 0 ? <p>Aucune page repérée.</p> : <div>{cleanBookmarks.map(page => <button type="button" key={page} onClick={() => goTo(page)}>Page {page}</button>)}</div>}
          </details>
          <details className="pdf-notes" open={Boolean(currentNote)}>
            <summary>Notes ({cleanNotes.length})</summary>
            <div className="pdf-note-editor">
              <label htmlFor="pdf-page-note">Note de la page {pageNumber}</label>
              <textarea id="pdf-page-note" value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="Écris ici ce que tu veux retenir de cette page…" />
              <div className="pdf-note-actions"><button type="button" onClick={saveNote}>Enregistrer</button>{currentNote && <button type="button" onClick={deleteNote}>Supprimer la note</button>}</div>
            </div>
            {cleanNotes.length > 0 && <div className="pdf-note-list">{cleanNotes.map(note => <button type="button" key={note.page} onClick={() => goTo(note.page)}>p. {note.page} · {note.text.slice(0, 48)}{note.text.length > 48 ? '…' : ''}</button>)}</div>}
          </details>
        </div>
      </header>
      {error && <p className="pdf-error" role="alert">Lecture impossible : {error}</p>}
      <div className="pdf-canvas-host" ref={hostRef}>{rendering && <div className="pdf-loading">Rendu de la page…</div>}<canvas ref={canvasRef} aria-label={`Page ${pageNumber} du PDF`} /></div>
    </article>
  </main>;
}

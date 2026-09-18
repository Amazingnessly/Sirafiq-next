import { useEffect, useRef, useState } from 'react';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

type PdfViewerProps = {
  src: string;
  title: string;
};

type PdfViewport = {
  width: number;
  height: number;
};

type PdfRenderTask = {
  promise: Promise<void>;
  cancel: () => void;
};

type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
    transform?: [number, number, number, number, number, number];
    canvas: HTMLCanvasElement;
  }) => PdfRenderTask;
};

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

type PdfLoadingTask = {
  promise: Promise<PdfDocument>;
  destroy: () => Promise<void>;
};

const PDF_PAGE_STORAGE_PREFIX = 'sirafiq:pdf-page:';

function pageStorageKey(src: string) {
  return `${PDF_PAGE_STORAGE_PREFIX}${src}`;
}

function readSavedPage(src: string, pageCount: number) {
  try {
    const value = Number.parseInt(window.localStorage.getItem(pageStorageKey(src)) ?? '', 10);
    if (!Number.isFinite(value)) return 1;
    return Math.min(Math.max(value, 1), pageCount);
  } catch {
    return 1;
  }
}

function savePage(src: string, pageNumber: number) {
  try {
    window.localStorage.setItem(pageStorageKey(src), String(pageNumber));
  } catch {
    // Reading must remain usable when Safari blocks or exhausts local storage.
  }
}

export function PdfViewer({ src, title }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [stageWidth, setStageWidth] = useState(0);
  const [loadingDocument, setLoadingDocument] = useState(true);
  const [renderingPage, setRenderingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;

    const updateWidth = () => setStageWidth(node.clientWidth);
    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PdfLoadingTask | null = null;

    setLoadingDocument(true);
    setError(null);
    setPageNumber(1);
    setPageCount(0);

    async function openDocument() {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const isServerDocument = src.startsWith('/api/resource-versions/');
        loadingTask = pdfjs.getDocument({
          url: src,
          rangeChunkSize: 512 * 1024,
          disableStream: isServerDocument,
          disableAutoFetch: isServerDocument,
        }) as unknown as PdfLoadingTask;
        const pdfDocument = await loadingTask.promise;
        if (cancelled) {
          await pdfDocument.destroy();
          return;
        }
        documentRef.current = pdfDocument;
        setPageCount(pdfDocument.numPages);
        setPageNumber(readSavedPage(src, pdfDocument.numPages));
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Le PDF n’a pas pu être ouvert.');
        }
      } finally {
        if (!cancelled) setLoadingDocument(false);
      }
    }

    void openDocument();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      const currentDocument = documentRef.current;
      documentRef.current = null;
      if (currentDocument) void currentDocument.destroy();
      else if (loadingTask) void loadingTask.destroy();
    };
  }, [src]);

  useEffect(() => {
    if (pageCount > 0) savePage(src, pageNumber);
  }, [pageCount, pageNumber, src]);

  useEffect(() => {
    const currentDocument = documentRef.current;
    const currentCanvas = canvasRef.current;
    if (!currentDocument || !currentCanvas || !pageCount || !stageWidth) return;

    let cancelled = false;
    setRenderingPage(true);
    setError(null);

    async function renderPage(pdfDocument: PdfDocument, canvasElement: HTMLCanvasElement) {
      try {
        renderTaskRef.current?.cancel();
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(240, stageWidth - 32);
        const cssScale = Math.min(2, availableWidth / baseViewport.width);
        const viewport = page.getViewport({ scale: cssScale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
        const context = canvasElement.getContext('2d', { alpha: false });
        if (!context) throw new Error('Le moteur de dessin du navigateur est indisponible.');

        canvasElement.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvasElement.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvasElement.style.width = `${Math.floor(viewport.width)}px`;
        canvasElement.style.height = `${Math.floor(viewport.height)}px`;

        const transform = outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] as [number, number, number, number, number, number];
        const renderTask = page.render({ canvasContext: context, viewport, transform, canvas: canvasElement });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (cause) {
        if (!cancelled && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) {
          setError(cause instanceof Error ? cause.message : 'Cette page n’a pas pu être affichée.');
        }
      } finally {
        if (!cancelled) setRenderingPage(false);
      }
    }

    void renderPage(currentDocument, currentCanvas);
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pageCount, pageNumber, stageWidth]);

  function goToPage(nextPage: number) {
    if (!Number.isFinite(nextPage)) return;
    const bounded = Math.min(Math.max(Math.trunc(nextPage), 1), pageCount || 1);
    setPageNumber(bounded);
  }

  return (
    <section className="document-viewer pdf-reader" aria-label={`Lecteur PDF — ${title}`}>
      <div className="pdf-reader__toolbar">
        <button
          className="button button--secondary"
          type="button"
          disabled={loadingDocument || pageNumber <= 1}
          onClick={() => goToPage(pageNumber - 1)}
          aria-label="Page précédente"
        >
          ← Précédente
        </button>
        <div className="pdf-reader__position" aria-live="polite">
          {pageCount ? (
            <label>
              Page{' '}
              <input
                type="number"
                min={1}
                max={pageCount}
                value={pageNumber}
                disabled={loadingDocument}
                onChange={(event) => goToPage(event.currentTarget.valueAsNumber)}
                aria-label="Aller à la page"
                inputMode="numeric"
              />{' '}
              sur {pageCount}
            </label>
          ) : 'Ouverture du PDF…'}
        </div>
        <button
          className="button button--secondary"
          type="button"
          disabled={loadingDocument || !pageCount || pageNumber >= pageCount}
          onClick={() => goToPage(pageNumber + 1)}
          aria-label="Page suivante"
        >
          Suivante →
        </button>
      </div>

      <div className="pdf-reader__stage" ref={stageRef}>
        {loadingDocument && <div className="pdf-reader__message">Ouverture du document…</div>}
        {error && <div className="pdf-reader__message pdf-reader__message--error" role="alert">{error}</div>}
        <canvas
          ref={canvasRef}
          aria-label={pageCount ? `Page ${pageNumber} du PDF ${title}` : `PDF ${title}`}
          className={loadingDocument || error ? 'is-hidden' : ''}
        />
        {renderingPage && !loadingDocument && !error && <div className="pdf-reader__busy" aria-live="polite">Affichage de la page…</div>}
      </div>
    </section>
  );
}

import * as mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { sampleLongText, selectPdfSamplePages } from './aiSampling.mjs';
import { blobToArrayBuffer, createSupportByteSource, getSupportMetadata, loadSupportBlob } from './storage';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_CONTEXT_CHARS = 90_000;
const MAX_PDF_SAMPLE_PAGES = 60;

type StoredAiSupport = {
  id: string;
  name: string;
  type?: string;
  extraction?: { text?: string };
};

export type AiContext = {
  text: string;
  truncated: boolean;
  pagesRead?: number;
};

class ContextRangeTransport extends pdfjs.PDFDataRangeTransport {
  private aborted = false;

  constructor(
    private readonly source: { size: number; readRange: (begin: number, end: number) => Promise<Uint8Array>; close?: () => void },
    private readonly onReadError: (error: unknown) => void,
  ) {
    super(source.size, null);
  }

  requestDataRange(begin: number, end: number): void {
    if (this.aborted) return;
    const safeBegin = Math.min(this.source.size, Math.max(0, begin));
    const safeEnd = Math.min(this.source.size, Math.max(safeBegin, end));
    void this.source.readRange(safeBegin, safeEnd).then(data => {
      if (this.aborted) return;
      this.onDataRange(safeBegin, data);
      this.onDataProgress(safeEnd, this.source.size);
    }).catch(error => {
      if (this.aborted) return;
      this.aborted = true;
      this.source.close?.();
      this.onReadError(error);
    });
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.source.close?.();
  }
}

function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function finalizeText(text: string): AiContext {
  const clean = text.replace(/\u0000/g, '').replace(/\n{4,}/g, '\n\n\n').trim();
  if (!clean) throw new Error('Aucun texte exploitable n’a été détecté dans ce support.');
  return sampleLongText(clean, MAX_CONTEXT_CHARS);
}

async function extractPdfContext(support: StoredAiSupport): Promise<AiContext> {
  const source = await createSupportByteSource(support.id, support.type || 'application/pdf');
  let rejectRangeRead: (error: unknown) => void = () => undefined;
  const rangeFailure = new Promise<never>((_, reject) => { rejectRangeRead = reject; });
  const transport = new ContextRangeTransport(source, rejectRangeRead);
  const loadingTask = pdfjs.getDocument({
    range: transport,
    rangeChunkSize: 256 * 1024,
    disableStream: true,
    disableAutoFetch: true,
  });

  try {
    const pdf = await Promise.race([loadingTask.promise, rangeFailure]);
    const pageNumbers = selectPdfSamplePages(pdf.numPages, MAX_PDF_SAMPLE_PAGES);
    const chunks: string[] = [];
    let length = 0;
    let pagesRead = 0;
    let truncated = false;

    for (const pageNumber of pageNumbers) {
      const page = await Promise.race([pdf.getPage(pageNumber), rangeFailure]);
      const textContent = await Promise.race([page.getTextContent(), rangeFailure]);
      const pageText = textContent.items
        .map(item => ('str' in item && typeof item.str === 'string') ? item.str : '')
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pagesRead += 1;
      if (!pageText) continue;
      const chunk = `\n\n[Page ${pageNumber}]\n${pageText}`;
      const remaining = MAX_CONTEXT_CHARS - length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (chunk.length > remaining) {
        chunks.push(chunk.slice(0, remaining));
        truncated = true;
        break;
      }
      chunks.push(chunk);
      length += chunk.length;
    }

    const text = chunks.join('').trim();
    if (!text) throw new Error('Aucun texte exploitable n’a été détecté dans ce PDF.');
    return {
      text,
      truncated: truncated || pageNumbers.length < pdf.numPages || pagesRead < pageNumbers.length,
      pagesRead,
    };
  } finally {
    transport.abort();
    await loadingTask.destroy().catch(() => undefined);
  }
}

export async function loadAiContext(id: string, fallbackName: string): Promise<AiContext> {
  const support = await getSupportMetadata<StoredAiSupport>(id);
  if (!support) throw new Error('Support local introuvable.');
  const name = support.name || fallbackName;
  const extension = extensionOf(name);

  if (extension === 'pdf') return extractPdfContext(support);

  if (extension === 'docx') {
    const cached = support.extraction?.text?.trim();
    if (cached) return finalizeText(cached);
    const blob = await loadSupportBlob(id, support.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const result = await mammoth.extractRawText({ arrayBuffer: await blobToArrayBuffer(blob) });
    return finalizeText(result.value);
  }

  if (extension === 'txt' || extension === 'md') {
    const blob = await loadSupportBlob(id, support.type || 'text/plain');
    return finalizeText(await blob.text());
  }

  throw new Error('L’assistant IA prend actuellement en charge les supports PDF, DOCX, TXT et Markdown.');
}

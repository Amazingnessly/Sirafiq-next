import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ExtractedPage } from '../shared/contracts';
import {
  LOCAL_PDF_EXTRACTION_MAX_BYTES,
  MAX_EXTRACTED_CHARS,
  MAX_EXTRACTED_PAGES,
} from '../shared/importPolicy';
import { readBlobAsArrayBuffer, readBlobAsText } from './blob';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export class DocumentExtractionError extends Error {
  constructor(
    message: string,
    public readonly code: 'EMPTY_TEXT' | 'UNREADABLE_PDF' | 'UNSUPPORTED_TYPE' | 'TOO_LARGE',
  ) {
    super(message);
    this.name = 'DocumentExtractionError';
  }
}

export async function extractDocument(file: File): Promise<ExtractedPage[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const isPdf = file.type === 'application/pdf' || extension === 'pdf';

  if (isPdf) {
    if (file.size > LOCAL_PDF_EXTRACTION_MAX_BYTES) {
      throw new DocumentExtractionError(
        'Ce PDF dépasse 25 Mo pour l’extraction automatique locale. Le fichier peut toutefois être conservé et synchronisé.',
        'TOO_LARGE',
      );
    }
    return extractPdf(file);
  }

  if (file.type.startsWith('text/') || ['txt', 'md'].includes(extension ?? '')) {
    const text = (await readBlobAsText(file)).trim();
    if (!text) {
      throw new DocumentExtractionError('Ce document ne contient aucun texte exploitable.', 'EMPTY_TEXT');
    }
    if (text.length > MAX_EXTRACTED_CHARS) {
      throw new DocumentExtractionError('Le texte extrait dépasse la limite de cette première version.', 'TOO_LARGE');
    }
    return [{ pageNumber: 1, text }];
  }

  throw new DocumentExtractionError('Cette première version accepte les PDF, TXT et Markdown.', 'UNSUPPORTED_TYPE');
}

async function extractPdf(file: File): Promise<ExtractedPage[]> {
  try {
    const data = new Uint8Array(await readBlobAsArrayBuffer(file));
    const pdf = await getDocument({ data }).promise;
    if (pdf.numPages > MAX_EXTRACTED_PAGES) {
      throw new DocumentExtractionError(
        `Ce PDF contient ${pdf.numPages} pages ; la limite actuelle est ${MAX_EXTRACTED_PAGES}.`,
        'TOO_LARGE',
      );
    }

    const pages: ExtractedPage[] = [];
    let charCount = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      charCount += text.length;
      if (charCount > MAX_EXTRACTED_CHARS) {
        throw new DocumentExtractionError('Le texte extrait dépasse la limite de cette première version.', 'TOO_LARGE');
      }
      pages.push({ pageNumber, text });
    }

    const meaningfulChars = pages.reduce((sum, page) => sum + page.text.replace(/\s/g, '').length, 0);
    if (meaningfulChars < 20) {
      throw new DocumentExtractionError(
        'Le lecteur PDF local n’a pas trouvé assez de texte exploitable. Une extraction serveur pourra être tentée après synchronisation.',
        'EMPTY_TEXT',
      );
    }
    return pages;
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError(
      'Le lecteur PDF local n’a pas pu extraire ce document. Une extraction serveur pourra être tentée après synchronisation.',
      'UNREADABLE_PDF',
    );
  }
}

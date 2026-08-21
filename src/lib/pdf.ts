import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ExtractedPage } from '../shared/contracts';

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

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 2_000_000;
const MAX_PAGES = 500;

export async function extractDocument(file: File): Promise<ExtractedPage[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new DocumentExtractionError('Le fichier dépasse la limite de 25 Mo de cette première version.', 'TOO_LARGE');
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  if (file.type === 'application/pdf' || extension === 'pdf') {
    return extractPdf(file);
  }

  if (file.type.startsWith('text/') || ['txt', 'md'].includes(extension ?? '')) {
    const text = (await file.text()).trim();
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
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocument({ data }).promise;
    if (pdf.numPages > MAX_PAGES) {
      throw new DocumentExtractionError(`Ce PDF contient ${pdf.numPages} pages ; la limite actuelle est ${MAX_PAGES}.`, 'TOO_LARGE');
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
        'Le PDF semble scanné ou ne contient pas assez de texte extractible. Aucun exercice ne sera généré à partir de ce support.',
        'EMPTY_TEXT',
      );
    }
    return pages;
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError('Le PDF n’a pas pu être lu correctement.', 'UNREADABLE_PDF');
  }
}

import type { ExtractedPage } from '../shared/contracts';
import { MAX_EXTRACTED_CHARS, MAX_EXTRACTED_PAGE_CHARS } from '../shared/importPolicy';

export class TextExtractionError extends Error {
  constructor(
    message: string,
    public readonly code: 'EMPTY_TEXT' | 'TOO_LARGE',
  ) {
    super(message);
    this.name = 'TextExtractionError';
  }
}

export function extractTextContent(input: string): { pages: ExtractedPage[]; charCount: number } {
  const text = input.trim();
  if (!text) {
    throw new TextExtractionError('Ce document ne contient aucun texte exploitable.', 'EMPTY_TEXT');
  }
  if (text.length > MAX_EXTRACTED_CHARS) {
    throw new TextExtractionError('Le texte extrait dépasse la limite de cette première version.', 'TOO_LARGE');
  }

  const pages: ExtractedPage[] = [];
  let offset = 0;
  let pageNumber = 1;
  while (offset < text.length) {
    let end = Math.min(offset + MAX_EXTRACTED_PAGE_CHARS, text.length);
    if (
      end < text.length
      && end > offset
      && isHighSurrogate(text.charCodeAt(end - 1))
      && isLowSurrogate(text.charCodeAt(end))
    ) {
      end -= 1;
    }
    pages.push({ pageNumber, text: text.slice(offset, end) });
    pageNumber += 1;
    offset = end;
  }

  return { pages, charCount: text.length };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

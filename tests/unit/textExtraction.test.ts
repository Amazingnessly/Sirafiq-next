import { describe, expect, it } from 'vitest';
import { MAX_EXTRACTED_CHARS, MAX_EXTRACTED_PAGE_CHARS } from '../../src/shared/importPolicy';
import { extractTextContent, TextExtractionError } from '../../src/lib/textExtraction';

describe('text extraction sync contract', () => {
  it('splits text into pages accepted by the server contract without losing characters', () => {
    const text = 'a'.repeat(MAX_EXTRACTED_PAGE_CHARS - 1) + '😀' + 'b'.repeat(17);
    const result = extractTextContent(text);

    expect(result.charCount).toBe(text.length);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.text.length).toBe(MAX_EXTRACTED_PAGE_CHARS - 1);
    expect(result.pages.every((page) => page.text.length <= MAX_EXTRACTED_PAGE_CHARS)).toBe(true);
    expect(result.pages.map((page) => page.text).join('')).toBe(text);
  });

  it('rejects text beyond the total extraction limit before it can create unsynchronizable metadata', () => {
    expect(() => extractTextContent('x'.repeat(MAX_EXTRACTED_CHARS + 1))).toThrowError(TextExtractionError);
    try {
      extractTextContent('x'.repeat(MAX_EXTRACTED_CHARS + 1));
    } catch (error) {
      expect(error).toMatchObject({ code: 'TOO_LARGE' });
    }
  });

  it('rejects whitespace-only text as unusable extraction data', () => {
    expect(() => extractTextContent(' \n\t ')).toThrowError(TextExtractionError);
    try {
      extractTextContent(' \n\t ');
    } catch (error) {
      expect(error).toMatchObject({ code: 'EMPTY_TEXT' });
    }
  });
});

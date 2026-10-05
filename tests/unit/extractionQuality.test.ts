import { describe, expect, it } from 'vitest';
import { hasUsefulPdfExtractionText } from '../../src/lib/extractionQuality';

describe('PDF extraction quality gate', () => {
  it('rejects a synthetic contents list made only of page labels', () => {
    const text = ['Contents', ...Array.from({ length: 384 }, (_, index) => `Page ${index + 1}`)].join('\n');
    expect(hasUsefulPdfExtractionText(text)).toBe(false);
  });

  it('rejects page labels even when they exceed the old 20-character threshold', () => {
    expect(hasUsefulPdfExtractionText('Page 1\nPage 2\nPage 3\nPage 4\nPage 5')).toBe(false);
  });

  it('keeps a real table of contents when it contains substantive source text', () => {
    const text = [
      'Contents',
      'Introduction to Arabic morphology and the structure of the lesson',
      'Page 1',
      'Chapter one: nominal sentences and their principal grammatical roles',
      'Page 12',
      'Chapter two: verbal sentences with worked examples and exercises',
      'Page 28',
    ].join('\n');
    expect(hasUsefulPdfExtractionText(text)).toBe(true);
  });

  it('accepts ordinary extracted source text', () => {
    expect(hasUsefulPdfExtractionText(
      'هذا نص عربي مستخرج من الملف ويحتوي على مادة تعليمية حقيقية يمكن مراجعتها.',
    )).toBe(true);
  });
});

const PDF_NAVIGATION_LINE = /^(?:contents?|table of contents|page\s+\d+(?:\s*[-–—]\s*\d+)?)$/i;

export function hasUsefulPdfExtractionText(input: string): boolean {
  const normalized = input.replace(/\u0000/g, '').trim();
  if (normalized.replace(/\s/g, '').length < 20) return false;

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  const navigationLines = lines.filter((line) => PDF_NAVIGATION_LINE.test(line));
  const substantiveText = lines
    .filter((line) => !PDF_NAVIGATION_LINE.test(line))
    .join(' ')
    .replace(/\s/g, '');

  // Some PDF conversion backends return only a synthetic table of page
  // labels ("Contents", "Page 1", "Page 2", ...). It is technically text,
  // but it is not source content that Sirāfiq can safely use for learning.
  if (substantiveText.length < 20 && navigationLines.length >= Math.min(4, lines.length)) {
    return false;
  }

  // Keep legitimate tables of contents: chapter titles and other substantive
  // lines quickly exceed this allowance even when many page labels exist.
  if (lines.length >= 8 && navigationLines.length / lines.length >= 0.8 && substantiveText.length < 100) {
    return false;
  }

  return true;
}

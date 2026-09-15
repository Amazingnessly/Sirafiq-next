export function selectPdfSamplePages(totalPages, maxPages = 60) {
  const total = Number.isFinite(totalPages) ? Math.max(0, Math.trunc(totalPages)) : 0;
  const limit = Number.isFinite(maxPages) ? Math.max(0, Math.trunc(maxPages)) : 0;
  if (!total || !limit) return [];
  if (total <= limit) return Array.from({ length: total }, (_, index) => index + 1);
  if (limit === 1) return [1];

  const pages = [];
  for (let index = 0; index < limit; index += 1) {
    const page = Math.round(1 + index * (total - 1) / (limit - 1));
    if (pages[pages.length - 1] !== page) pages.push(page);
  }
  return pages;
}

export function sampleLongText(text, maxChars = 90_000) {
  if (typeof text !== 'string') return { text: '', truncated: false };
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.trunc(maxChars)) : 0;
  if (!limit) return { text: '', truncated: text.length > 0 };
  if (text.length <= limit) return { text, truncated: false };

  const startMarker = '[Début du document]\n';
  const middleMarker = '\n\n[Milieu du document]\n';
  const endMarker = '\n\n[Fin du document]\n';
  const markerLength = startMarker.length + middleMarker.length + endMarker.length;
  const budget = Math.max(0, limit - markerLength);
  const startLength = Math.floor(budget * 0.4);
  const middleLength = Math.floor(budget * 0.3);
  const endLength = Math.max(0, budget - startLength - middleLength);

  const middleStart = Math.max(startLength, Math.floor(text.length / 2 - middleLength / 2));
  const endStart = Math.max(middleStart + middleLength, text.length - endLength);
  const sampled = `${startMarker}${text.slice(0, startLength)}${middleMarker}${text.slice(middleStart, middleStart + middleLength)}${endMarker}${text.slice(endStart)}`;
  return { text: sampled.slice(0, limit), truncated: true };
}

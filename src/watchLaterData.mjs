const STATUSES = new Set(['À voir', 'En cours', 'Terminé']);
const PRIORITIES = new Set(['Maintenant', 'Bientôt', 'Plus tard']);

export function normalizeWatchUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isOptionalString(value) {
  return value === undefined || typeof value === 'string';
}

function isValidDate(value) {
  return typeof value === 'string' && Boolean(value) && Number.isFinite(Date.parse(value));
}

export function validateWatchItems(value) {
  if (!Array.isArray(value)) return { ok: false, items: [] };

  const ids = new Set();
  const items = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return { ok: false, items: [] };

    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    const collection = typeof candidate.collection === 'string' ? candidate.collection.trim() : '';
    const url = normalizeWatchUrl(candidate.url);
    if (!id || ids.has(id) || !title || !collection || !url) return { ok: false, items: [] };
    if (!STATUSES.has(candidate.status)) return { ok: false, items: [] };
    if (candidate.priority !== undefined && !PRIORITIES.has(candidate.priority)) return { ok: false, items: [] };
    if (!isOptionalString(candidate.resumeNote) || !isOptionalString(candidate.lastOpenedAt)) return { ok: false, items: [] };
    if (!isValidDate(candidate.addedAt)) return { ok: false, items: [] };
    if (candidate.lastOpenedAt !== undefined && candidate.lastOpenedAt !== '' && !isValidDate(candidate.lastOpenedAt)) return { ok: false, items: [] };

    ids.add(id);
    items.push({
      id,
      title,
      url,
      collection,
      status: candidate.status,
      ...(candidate.priority !== undefined ? { priority: candidate.priority } : {}),
      ...(typeof candidate.resumeNote === 'string' && candidate.resumeNote.trim() ? { resumeNote: candidate.resumeNote.trim() } : {}),
      ...(typeof candidate.lastOpenedAt === 'string' && candidate.lastOpenedAt ? { lastOpenedAt: candidate.lastOpenedAt } : {}),
      addedAt: candidate.addedAt,
    });
  }

  return { ok: true, items };
}

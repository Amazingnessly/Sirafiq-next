const DEFAULT_MAX_CHARS = 32_000;
const DEFAULT_CHUNK_CHARS = 2_600;

const STOP_WORDS = new Set([
  'afin','alors','apres','avec','avoir','aux','cela','ces','cet','cette','comme','dans','des','donc','elle','elles','entre','est','etre','faire','faut','ils','les','leur','leurs','mais','meme','nous','par','pas','plus','pour','que','qui','sans','ses','son','sont','sous','sur','tous','tout','toute','toutes','une','vous',
  'comment','pourquoi','quel','quelle','quelles','quels','quoi','support','document','explique','expliquer','retenir','notion','notions','principal','principale','principales','principaux','point','points','essentiel','essentiels',
]);

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr');
}

export function queryTerms(question) {
  const terms = normalize(question)
    .split(/[^a-z0-9]+/g)
    .filter(term => term.length >= 3 && !STOP_WORDS.has(term));
  return [...new Set(terms)].slice(0, 24);
}

function splitLongBlock(block, targetChars) {
  const chunks = [];
  let start = 0;
  while (start < block.length) {
    let end = Math.min(block.length, start + targetChars);
    if (end < block.length) {
      const whitespace = block.lastIndexOf(' ', end);
      if (whitespace > start + Math.floor(targetChars * 0.65)) end = whitespace;
    }
    const chunk = block.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = Math.max(end, start + 1);
    while (start < block.length && /\s/.test(block[start])) start += 1;
  }
  return chunks;
}

export function chunkAiContext(text, targetChars = DEFAULT_CHUNK_CHARS) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const blocks = text.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  const raw = blocks.flatMap(block => block.length > targetChars ? splitLongBlock(block, targetChars) : [block]);
  const chunks = [];
  let current = '';
  for (const block of raw) {
    const next = current ? `${current}\n\n${block}` : block;
    if (current && next.length > targetChars) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let cursor = 0;
  while (count < 6) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) break;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function chunkScore(chunk, terms) {
  const normalized = normalize(chunk);
  return terms.reduce((score, term) => score + countOccurrences(normalized, term), 0);
}

function distributedIndices(length, desired) {
  if (length <= 0 || desired <= 0) return [];
  if (desired === 1 || length === 1) return [0];
  const count = Math.min(length, desired);
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const value = Math.round(index * (length - 1) / (count - 1));
    if (result[result.length - 1] !== value) result.push(value);
  }
  return result;
}

export function selectQueryContext(text, question, maxChars = DEFAULT_MAX_CHARS) {
  const source = typeof text === 'string' ? text.trim() : '';
  const limit = Number.isFinite(maxChars) ? Math.max(1_000, Math.trunc(maxChars)) : DEFAULT_MAX_CHARS;
  if (!source || source.length <= limit) {
    return { text: source, reduced: false, selectedChunks: source ? 1 : 0, totalChunks: source ? 1 : 0 };
  }

  const chunks = chunkAiContext(source);
  if (!chunks.length) return { text: '', reduced: true, selectedChunks: 0, totalChunks: 0 };
  const terms = queryTerms(question);
  const scored = chunks
    .map((chunk, index) => ({ index, score: chunkScore(chunk, terms) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected = new Set();
  let usedChars = 0;
  const tryAdd = index => {
    if (index < 0 || index >= chunks.length || selected.has(index)) return false;
    const separator = selected.size ? 2 : 0;
    const cost = chunks[index].length + separator;
    if (usedChars + cost > limit) return false;
    selected.add(index);
    usedChars += cost;
    return true;
  };

  for (const item of scored) {
    tryAdd(item.index);
    if (usedChars >= limit * 0.64) break;
  }

  for (const item of scored) {
    tryAdd(item.index - 1);
    tryAdd(item.index + 1);
    if (usedChars >= limit * 0.82) break;
  }

  const desiredFallback = Math.max(3, Math.ceil(limit / DEFAULT_CHUNK_CHARS));
  for (const index of distributedIndices(chunks.length, desiredFallback)) tryAdd(index);

  if (!selected.size) tryAdd(0);
  const ordered = [...selected].sort((a, b) => a - b);
  const selectedText = ordered.map(index => chunks[index]).join('\n\n').slice(0, limit).trim();
  return {
    text: selectedText,
    reduced: selectedText.length < source.length,
    selectedChunks: ordered.length,
    totalChunks: chunks.length,
  };
}

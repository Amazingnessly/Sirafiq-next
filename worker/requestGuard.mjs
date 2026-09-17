import app from './index.mjs';

export const MAX_AI_REQUEST_BYTES = 180_000;
export const AI_RATE_LIMIT_KEY = 'sirafiq-ai-global';

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export async function readBoundedBody(request, limit = MAX_AI_REQUEST_BYTES) {
  const announcedLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(announcedLength) && announcedLength > limit) {
    return { ok: false, reason: 'too_large' };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, bytes: new Uint8Array(0) };

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch { /* la requête est déjà rejetée */ }
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'read_error' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function shouldGuard(request) {
  if (request.method !== 'POST') return false;
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith('/api/ai/');
}

export async function enforceAiRateLimit(env) {
  if (!env?.AI_RATE_LIMITER || typeof env.AI_RATE_LIMITER.limit !== 'function') return null;
  try {
    const result = await env.AI_RATE_LIMITER.limit({ key: AI_RATE_LIMIT_KEY });
    if (!result?.success) {
      return json(
        { error: 'Trop de requêtes IA en peu de temps. Attends un instant puis réessaie.' },
        429,
        { 'retry-after': '60' },
      );
    }
  } catch (error) {
    console.error('Sirafiq AI rate limiter failed', error instanceof Error ? error.name : 'UnknownError');
  }
  return null;
}

async function delegate(request, env, ctx) {
  try {
    return await app.fetch(request, env, ctx);
  } catch (error) {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith('/api/')) throw error;
    console.error('Sirafiq API request failed', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'Le service IA a rencontré une erreur réseau inattendue. Réessaie dans un instant.' }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (!shouldGuard(request)) return delegate(request, env, ctx);

    const rateLimited = await enforceAiRateLimit(env);
    if (rateLimited) return rateLimited;

    const bounded = await readBoundedBody(request);
    if (!bounded.ok) {
      return bounded.reason === 'too_large'
        ? json({ error: 'Requête trop volumineuse.' }, 413)
        : json({ error: 'Impossible de lire la requête.' }, 400);
    }

    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const forwarded = new Request(request.url, {
      method: request.method,
      headers,
      body: bounded.bytes,
      redirect: request.redirect,
    });
    return delegate(forwarded, env, ctx);
  },
};

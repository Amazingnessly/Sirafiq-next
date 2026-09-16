import app from './index.mjs';

export const MAX_AI_REQUEST_BYTES = 180_000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
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

export default {
  async fetch(request, env, ctx) {
    if (!shouldGuard(request)) return app.fetch(request, env, ctx);

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
    return app.fetch(forwarded, env, ctx);
  },
};

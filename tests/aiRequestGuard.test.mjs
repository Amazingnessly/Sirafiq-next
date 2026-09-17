import test from 'node:test';
import assert from 'node:assert/strict';
import guardedWorker, { AI_RATE_LIMIT_KEY, MAX_AI_REQUEST_BYTES, enforceAiRateLimit, readBoundedBody } from '../worker/requestGuard.mjs';

test('readBoundedBody conserve un petit corps sans Content-Length', async () => {
  const body = JSON.stringify({ question: 'Que retenir ?' });
  const request = new Request('https://sirafiq.test/api/ai/ask', { method: 'POST', body });
  const result = await readBoundedBody(request);
  assert.equal(result.ok, true);
  assert.equal(new TextDecoder().decode(result.bytes), body);
});

test('readBoundedBody rejette une longueur annoncée trop grande avant lecture', async () => {
  const request = new Request('https://sirafiq.test/api/ai/ask', {
    method: 'POST',
    headers: { 'content-length': String(MAX_AI_REQUEST_BYTES + 1) },
    body: '{}',
  });
  const result = await readBoundedBody(request);
  assert.deepEqual(result, { ok: false, reason: 'too_large' });
});

test('readBoundedBody coupe un corps streamé trop grand sans Content-Length', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(100_000));
      controller.enqueue(new Uint8Array(MAX_AI_REQUEST_BYTES - 100_000 + 1));
      controller.close();
    },
  });
  const request = new Request('https://sirafiq.test/api/ai/ask', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  });
  const result = await readBoundedBody(request);
  assert.deepEqual(result, { ok: false, reason: 'too_large' });
});

test('enforceAiRateLimit utilise une clé globale stable', async () => {
  let receivedKey = '';
  const response = await enforceAiRateLimit({
    AI_RATE_LIMITER: {
      limit: async ({ key }) => {
        receivedKey = key;
        return { success: true };
      },
    },
  });
  assert.equal(response, null);
  assert.equal(receivedKey, AI_RATE_LIMIT_KEY);
});

test('le Worker renvoie 429 avant la logique IA quand le budget est dépassé', async () => {
  let calls = 0;
  const request = new Request('https://sirafiq.test/api/ai/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ supportName: 'Cours.pdf', context: 'Contenu', question: 'Question' }),
  });
  const response = await guardedWorker.fetch(request, {
    AI_RATE_LIMITER: {
      limit: async ({ key }) => {
        calls += 1;
        assert.equal(key, AI_RATE_LIMIT_KEY);
        return { success: false };
      },
    },
  }, {});
  assert.equal(calls, 1);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.deepEqual(await response.json(), { error: 'Trop de requêtes IA en peu de temps. Attends un instant puis réessaie.' });
});

test('le Worker déployé renvoie 413 avant la logique IA pour un corps trop grand', async () => {
  const request = new Request('https://sirafiq.test/api/ai/ask', {
    method: 'POST',
    headers: { 'content-length': String(MAX_AI_REQUEST_BYTES + 1) },
    body: '{}',
  });
  const response = await guardedWorker.fetch(request, {}, {});
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Requête trop volumineuse.' });
});

test('un petit corps est retransmis au Worker IA après reconstruction', async () => {
  const request = new Request('https://sirafiq.test/api/ai/ask', {
    method: 'POST',
    headers: {
      origin: 'https://sirafiq.test',
      'x-sirafiq-ai-token': 'access',
      'content-type': 'application/json',
    },
    body: '{json invalide',
  });
  const response = await guardedWorker.fetch(request, {
    OPENAI_API_KEY: 'secret',
    SIRAFIQ_AI_ACCESS_TOKEN: 'access',
  }, {});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'JSON invalide.' });
});

test('une panne réseau OpenAI devient une erreur JSON stable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('network unavailable'); };
  try {
    const request = new Request('https://sirafiq.test/api/ai/ask', {
      method: 'POST',
      headers: {
        origin: 'https://sirafiq.test',
        'x-sirafiq-ai-token': 'access',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        supportName: 'Cours.pdf',
        context: 'Un contenu de cours suffisamment clair.',
        question: 'Que faut-il retenir ?',
      }),
    });
    const response = await guardedWorker.fetch(request, {
      OPENAI_API_KEY: 'secret',
      SIRAFIQ_AI_ACCESS_TOKEN: 'access',
    }, {});
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Le service IA a rencontré une erreur réseau inattendue. Réessaie dans un instant.' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('les routes GET restent déléguées au Worker IA existant', async () => {
  const request = new Request('https://sirafiq.test/api/ai/status');
  const response = await guardedWorker.fetch(request, {}, {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.configured, false);
});

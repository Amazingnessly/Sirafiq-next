const MAX_CONTEXT_CHARS = 100_000;
const MAX_QUESTION_CHARS = 3_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function validateAiPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'Requête invalide.' };
  const supportName = typeof payload.supportName === 'string' ? payload.supportName.trim() : '';
  const context = typeof payload.context === 'string' ? payload.context.trim() : '';
  const question = typeof payload.question === 'string' ? payload.question.trim() : '';

  if (!supportName) return { ok: false, error: 'Nom du support manquant.' };
  if (!context) return { ok: false, error: 'Aucun contenu exploitable n’a été fourni.' };
  if (!question) return { ok: false, error: 'Question manquante.' };
  if (context.length > MAX_CONTEXT_CHARS) return { ok: false, error: 'Le contexte envoyé est trop volumineux.' };
  if (question.length > MAX_QUESTION_CHARS) return { ok: false, error: 'La question est trop longue.' };

  return { ok: true, value: { supportName: supportName.slice(0, 300), context, question } };
}

export function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  if (!Array.isArray(response?.output)) return '';
  return response.output
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function matchesSecret(candidate, expected) {
  if (!candidate || !expected) return false;
  const encoder = new TextEncoder();
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function handleAi(request, env) {
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  if (!env.OPENAI_API_KEY || !env.SIRAFIQ_AI_ACCESS_TOKEN) {
    return json({ error: 'L’assistant IA n’est pas encore configuré sur ce déploiement.' }, 503);
  }

  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== requestOrigin) return json({ error: 'Origine non autorisée.' }, 403);

  const accessToken = request.headers.get('x-sirafiq-ai-token') ?? '';
  if (!(await matchesSecret(accessToken, env.SIRAFIQ_AI_ACCESS_TOKEN))) {
    return json({ error: 'Code d’accès IA incorrect ou absent.' }, 401);
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 180_000) {
    return json({ error: 'Requête trop volumineuse.' }, 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'JSON invalide.' }, 400);
  }

  const validated = validateAiPayload(payload);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const { supportName, context, question } = validated.value;

  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-5.6-terra',
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 1400,
      instructions: 'Tu es l’assistant d’étude de Sirāfiq. Réponds en français, avec précision et concision. Fonde ta réponse uniquement sur le contexte fourni par l’utilisateur. Si le contexte ne permet pas de répondre avec certitude, dis-le explicitement. Ne prétends jamais avoir lu une partie du document absente du contexte.',
      input: `SUPPORT : ${supportName}\n\nCONTEXTE FOURNI PAR L’UTILISATEUR :\n${context}\n\nQUESTION :\n${question}`,
    }),
  });

  if (!upstream.ok) {
    if (upstream.status === 429) return json({ error: 'Le service IA est momentanément trop sollicité. Réessaie plus tard.' }, 429);
    if (upstream.status === 401 || upstream.status === 403) return json({ error: 'La configuration OpenAI du serveur est invalide.' }, 503);
    return json({ error: 'Le service IA n’a pas pu répondre.' }, 502);
  }

  const data = await upstream.json();
  const answer = extractOutputText(data);
  if (!answer) return json({ error: 'Le service IA a répondu sans texte exploitable.' }, 502);
  return json({ answer, model: data.model || env.OPENAI_MODEL || 'gpt-5.6-terra' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ai/ask') return handleAi(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Route API inconnue.' }, 404);
    return env.ASSETS.fetch(request);
  },
};

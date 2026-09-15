const MAX_CONTEXT_CHARS = 100_000;
const MAX_QUESTION_CHARS = 3_000;
const MAX_REQUEST_BYTES = 180_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function aiConfigurationStatus(env = {}) {
  return {
    configured: Boolean(env.OPENAI_API_KEY && env.SIRAFIQ_AI_ACCESS_TOKEN),
    model: env.OPENAI_MODEL || 'gpt-5.6-terra',
    version: 4,
  };
}

function basePayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'Requête invalide.' };
  const supportName = typeof payload.supportName === 'string' ? payload.supportName.trim() : '';
  const context = typeof payload.context === 'string' ? payload.context.trim() : '';
  if (!supportName) return { ok: false, error: 'Nom du support manquant.' };
  if (!context) return { ok: false, error: 'Aucun contenu exploitable n’a été fourni.' };
  if (context.length > MAX_CONTEXT_CHARS) return { ok: false, error: 'Le contexte envoyé est trop volumineux.' };
  return { ok: true, value: { supportName: supportName.slice(0, 300), context } };
}

export function validateAiPayload(payload) {
  const base = basePayload(payload);
  if (!base.ok) return base;
  const question = typeof payload.question === 'string' ? payload.question.trim() : '';
  if (!question) return { ok: false, error: 'Question manquante.' };
  if (question.length > MAX_QUESTION_CHARS) return { ok: false, error: 'La question est trop longue.' };
  return { ok: true, value: { ...base.value, question } };
}

export function validateFlashcardPayload(payload) {
  const base = basePayload(payload);
  if (!base.ok) return base;
  const count = Number(payload.count);
  if (!Number.isInteger(count) || count < 3 || count > 10) {
    return { ok: false, error: 'Le nombre de cartes doit être compris entre 3 et 10.' };
  }
  return { ok: true, value: { ...base.value, count } };
}

export function validatePassagePayload(payload) {
  const base = basePayload(payload);
  if (!base.ok) return base;
  const count = Number(payload.count);
  if (!Number.isInteger(count) || ![3, 5].includes(count)) {
    return { ok: false, error: 'Le nombre de passages doit être 3 ou 5.' };
  }
  return { ok: true, value: { ...base.value, count } };
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

export function parseFlashcardsOutput(response) {
  const text = extractOutputText(response);
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.cards)) return [];
  return parsed.cards
    .map(card => ({
      front: typeof card?.front === 'string' ? card.front.trim() : '',
      back: typeof card?.back === 'string' ? card.back.trim() : '',
    }))
    .filter(card => card.front && card.back)
    .slice(0, 10);
}

export function parseMindMapOutput(response) {
  const text = extractOutputText(response);
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.nodes)) return [];

  const nodes = parsed.nodes
    .map(node => ({
      key: typeof node?.key === 'string' ? node.key.trim() : '',
      parentKey: typeof node?.parentKey === 'string' ? node.parentKey.trim() : '',
      text: typeof node?.text === 'string' ? node.text.trim() : '',
    }))
    .filter(node => node.key && node.text)
    .slice(0, 20);

  if (nodes.length < 2) return [];
  const keys = new Set();
  for (const node of nodes) {
    if (keys.has(node.key)) return [];
    keys.add(node.key);
  }

  const roots = nodes.filter(node => !node.parentKey);
  if (roots.length !== 1) return [];
  const rootKey = roots[0].key;

  for (const node of nodes) {
    if (node.key === rootKey) continue;
    if (!node.parentKey || node.parentKey === node.key || !keys.has(node.parentKey)) return [];
    const seen = new Set([node.key]);
    let cursor = node.parentKey;
    while (cursor !== rootKey) {
      if (seen.has(cursor)) return [];
      seen.add(cursor);
      const parent = nodes.find(candidate => candidate.key === cursor);
      if (!parent?.parentKey) return [];
      cursor = parent.parentKey;
    }
  }

  return nodes;
}

function normalizedWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseMemoryPassagesOutput(response, context) {
  const text = extractOutputText(response);
  if (!text || typeof context !== 'string') return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.passages)) return [];
  const source = normalizedWhitespace(context);
  const seen = new Set();
  return parsed.passages
    .map(passage => ({
      title: typeof passage?.title === 'string' ? passage.title.trim() : '',
      text: typeof passage?.text === 'string' ? passage.text.trim() : '',
    }))
    .filter(passage => {
      if (!passage.title || !passage.text) return false;
      const normalized = normalizedWhitespace(passage.text);
      if (normalized.length < 40 || !source.includes(normalized) || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 5);
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

async function authorize(request, env) {
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
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: 'Requête trop volumineuse.' }, 413);
  }
  return null;
}

async function readPayload(request) {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: json({ error: 'JSON invalide.' }, 400) };
  }
}

function upstreamError(upstream) {
  if (upstream.status === 429) return json({ error: 'Le service IA est momentanément trop sollicité. Réessaie plus tard.' }, 429);
  if (upstream.status === 401 || upstream.status === 403) return json({ error: 'La configuration OpenAI du serveur est invalide.' }, 503);
  return json({ error: 'Le service IA n’a pas pu répondre.' }, 502);
}

async function callOpenAI(env, body) {
  return fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function handleAsk(request, env) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  const payload = await readPayload(request);
  if (!payload.ok) return payload.response;
  const validated = validateAiPayload(payload.value);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const { supportName, context, question } = validated.value;

  const upstream = await callOpenAI(env, {
    model: env.OPENAI_MODEL || 'gpt-5.6-terra',
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: 1400,
    instructions: 'Tu es l’assistant d’étude de Sirāfiq. Réponds en français, avec précision et concision. Fonde ta réponse uniquement sur le contexte fourni par l’utilisateur. Si le contexte ne permet pas de répondre avec certitude, dis-le explicitement. Ne prétends jamais avoir lu une partie du document absente du contexte.',
    input: `SUPPORT : ${supportName}\n\nCONTEXTE FOURNI PAR L’UTILISATEUR :\n${context}\n\nQUESTION :\n${question}`,
  });

  if (!upstream.ok) return upstreamError(upstream);
  const data = await upstream.json();
  const answer = extractOutputText(data);
  if (!answer) return json({ error: 'Le service IA a répondu sans texte exploitable.' }, 502);
  return json({ answer, model: data.model || env.OPENAI_MODEL || 'gpt-5.6-terra' });
}

function flashcardSchema(count) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['cards'],
    properties: {
      cards: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['front', 'back'],
          properties: {
            front: { type: 'string', minLength: 1, maxLength: 300 },
            back: { type: 'string', minLength: 1, maxLength: 1200 },
          },
        },
      },
    },
  };
}

async function handleFlashcards(request, env) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  const payload = await readPayload(request);
  if (!payload.ok) return payload.response;
  const validated = validateFlashcardPayload(payload.value);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const { supportName, context, count } = validated.value;

  const upstream = await callOpenAI(env, {
    model: env.OPENAI_MODEL || 'gpt-5.6-terra',
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: 2600,
    text: {
      format: {
        type: 'json_schema',
        name: 'sirafiq_flashcards',
        strict: true,
        schema: flashcardSchema(count),
      },
    },
    instructions: 'Tu crées des cartes de rappel actif pour Sirāfiq. Fonde chaque carte uniquement sur le contexte fourni. Les questions doivent être précises, autonomes et utiles à la mémorisation. Les réponses doivent être exactes et assez courtes pour être rappelées. N’ajoute aucune information absente du contexte.',
    input: `SUPPORT : ${supportName}\n\nCONTEXTE FOURNI PAR L’UTILISATEUR :\n${context}\n\nCrée exactement ${count} cartes mémoire distinctes couvrant les notions les plus importantes de ce contexte.`,
  });

  if (!upstream.ok) return upstreamError(upstream);
  const data = await upstream.json();
  const cards = parseFlashcardsOutput(data);
  if (cards.length !== count) return json({ error: 'Le service IA n’a pas produit le nombre de cartes attendu.' }, 502);
  return json({ cards, model: data.model || env.OPENAI_MODEL || 'gpt-5.6-terra' });
}

function mindMapSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['nodes'],
    properties: {
      nodes: {
        type: 'array',
        minItems: 7,
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'parentKey', 'text'],
          properties: {
            key: { type: 'string', minLength: 1, maxLength: 40 },
            parentKey: { type: 'string', maxLength: 40 },
            text: { type: 'string', minLength: 1, maxLength: 180 },
          },
        },
      },
    },
  };
}

async function handleMindMap(request, env) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  const payload = await readPayload(request);
  if (!payload.ok) return payload.response;
  const validated = basePayload(payload.value);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const { supportName, context } = validated.value;

  const upstream = await callOpenAI(env, {
    model: env.OPENAI_MODEL || 'gpt-5.6-terra',
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: 3000,
    text: {
      format: {
        type: 'json_schema',
        name: 'sirafiq_mind_map',
        strict: true,
        schema: mindMapSchema(),
      },
    },
    instructions: 'Tu construis une carte mentale pédagogique pour Sirāfiq uniquement à partir du contexte fourni. Organise les notions du général vers le précis. Crée exactement une racine avec parentKey vide, puis des branches et sous-branches reliées par parentKey. Les textes doivent être courts, précis et autonomes. N’ajoute aucune information absente du contexte. Évite les doublons et limite la profondeur à quatre niveaux.',
    input: `SUPPORT : ${supportName}\n\nCONTEXTE FOURNI PAR L’UTILISATEUR :\n${context}\n\nCrée une carte mentale de 7 à 20 nœuds couvrant la structure et les notions les plus importantes de ce contexte. Utilise des clés courtes et uniques.`,
  });

  if (!upstream.ok) return upstreamError(upstream);
  const data = await upstream.json();
  const nodes = parseMindMapOutput(data);
  if (nodes.length < 2) return json({ error: 'Le service IA n’a pas produit une carte mentale hiérarchique exploitable.' }, 502);
  return json({ nodes, model: data.model || env.OPENAI_MODEL || 'gpt-5.6-terra' });
}

function passageSchema(count) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['passages'],
    properties: {
      passages: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'text'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 120 },
            text: { type: 'string', minLength: 40, maxLength: 1800 },
          },
        },
      },
    },
  };
}

async function handlePassages(request, env) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  const payload = await readPayload(request);
  if (!payload.ok) return payload.response;
  const validated = validatePassagePayload(payload.value);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const { supportName, context, count } = validated.value;

  const upstream = await callOpenAI(env, {
    model: env.OPENAI_MODEL || 'gpt-5.6-terra',
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: 3600,
    text: {
      format: {
        type: 'json_schema',
        name: 'sirafiq_memory_passages',
        strict: true,
        schema: passageSchema(count),
      },
    },
    instructions: 'Tu sélectionnes des passages à mémoriser pour Sirāfiq. Chaque champ text doit être une copie fidèle et consécutive du contexte fourni, sans paraphrase, correction, résumé ni ajout. Choisis des extraits autonomes, pédagogiquement utiles et distincts. Le titre peut être bref et descriptif. N’utilise aucun texte absent du contexte.',
    input: `SUPPORT : ${supportName}\n\nCONTEXTE FOURNI PAR L’UTILISATEUR :\n${context}\n\nSélectionne exactement ${count} passages distincts, chacun assez court pour être mémorisé mais assez complet pour avoir un sens autonome.`,
  });

  if (!upstream.ok) return upstreamError(upstream);
  const data = await upstream.json();
  const passages = parseMemoryPassagesOutput(data, context);
  if (passages.length !== count) return json({ error: 'Les passages proposés ne correspondent pas fidèlement au texte du support.' }, 502);
  return json({ passages, model: data.model || env.OPENAI_MODEL || 'gpt-5.6-terra' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ai/status') {
      if (request.method !== 'GET') return json({ error: 'Méthode non autorisée.' }, 405);
      return json(aiConfigurationStatus(env));
    }
    if (url.pathname === '/api/ai/ask') return handleAsk(request, env);
    if (url.pathname === '/api/ai/flashcards') return handleFlashcards(request, env);
    if (url.pathname === '/api/ai/mindmap') return handleMindMap(request, env);
    if (url.pathname === '/api/ai/passages') return handlePassages(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Route API inconnue.' }, 404);
    return env.ASSETS.fetch(request);
  },
};

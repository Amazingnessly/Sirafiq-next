/**
 * Central Worker boundary for PRIVATE API routes.
 * All deployed origins fail closed unless Cloudflare Access is configured.
 * Only plain-HTTP loopback dev traffic bypasses the gateway; never use a
 * loopback route in a publicly reachable proxy.
 *
 * IMPORTANT: Authentication is NOT per-user authorization. D1/R2 is a
 * single shared namespace; do not authorize multiple unrelated users.
 */
type AccessEnv = {
  SIRAFIQ_ACCESS_TEAM_DOMAIN?: string;
  SIRAFIQ_ACCESS_AUD?: string;
};

type AccessJwk = JsonWebKey & { kid?: string; alg?: string; use?: string; kty?: string };
type Jwks = { keys?: AccessJwk[] };
type JwtHeader = { alg?: string; kid?: string; typ?: string };
type JwtClaims = { iss?: string; aud?: string | string[]; sub?: string; exp?: number; nbf?: number };

const KEY_CACHE_MS = 5 * 60 * 1000;
const cachedJwks = new Map<string, { expiresAt: number; value: Jwks }>();

function jsonError(status: number, code: string, message: string, retryable: boolean): Response {
  return new Response(JSON.stringify({ error: { code, message, retryable } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function decodePart<T>(input: string): T {
  if (!/^[A-Za-z0-9_-]+$/.test(input) || input.length > 16000) throw new Error('Invalid JWT segment');
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function decodeSignature(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(input) || input.length > 16000) throw new Error('Invalid JWT signature');
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
}

function validDomain(domain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(domain);
}

async function getJwks(domain: string): Promise<Jwks> {
  const cached = cachedJwks.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetch('https://' + domain + '/cdn-cgi/access/certs', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Unable to fetch Cloudflare Access public keys');
  const value = await response.json() as Jwks;
  if (!Array.isArray(value.keys) || value.keys.length === 0) throw new Error('Empty Access JWKS');
  cachedJwks.set(domain, { expiresAt: Date.now() + KEY_CACHE_MS, value });
  return value;
}

/** Verify signature AND issuer, audience, expiry and identity. Never trust mere header presence. */
export async function verifyCloudflareAccessJwt(
  token: string,
  domain: string,
  audience: string,
  loadKeys: (domain: string) => Promise<Jwks> = getJwks,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  try {
    if (!validDomain(domain) || !audience || token.length > 24000) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = decodePart<JwtHeader>(parts[0]!);
    const claims = decodePart<JwtClaims>(parts[1]!);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return false;
    if (claims.iss !== 'https://' + domain) return false;
    if (!(typeof claims.aud === 'string' ? claims.aud === audience : Array.isArray(claims.aud) && claims.aud.includes(audience))) return false;
    if (typeof claims.sub !== 'string' || !claims.sub) return false;
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || nowSeconds >= claims.exp) return false;
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || nowSeconds < claims.nbf)) return false;
    const jwks = await loadKeys(domain);
    const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const data = new TextEncoder().encode(parts[0]! + '.' + parts[1]!);
    const signature = decodeSignature(parts[2]!);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  } catch {
    return false;
  }
}

/**
 * Return null to continue to the app; a Response means stop BEFORE DB/R2 access.
 * /api/build and /api/health deliberately contain no user data.
 */
export async function denyUnauthenticatedApi(request: Request, env: object): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  if (request.method === 'GET' && (url.pathname === '/api/build' || url.pathname === '/api/health')) return null;

  // Allow browser-driven local E2E and manual dev without ever allowing remote
  // HTTP or HTTPS origins to skip the Cloudflare Access signature check.
  if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')) {
    return null;
  }

  const settings = env as AccessEnv;
  const domain = settings.SIRAFIQ_ACCESS_TEAM_DOMAIN?.trim().toLowerCase() ?? '';
  const audience = settings.SIRAFIQ_ACCESS_AUD?.trim() ?? '';
  if (!validDomain(domain) || !audience) {
    return jsonError(503, 'ACCESS_NOT_CONFIGURED', 'L’accès sécurisé à la bibliothèque n’est pas configuré.', false);
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return jsonError(401, 'AUTHENTICATION_REQUIRED', 'Une connexion sécurisée est nécessaire.', false);

  const valid = await verifyCloudflareAccessJwt(token, domain, audience);
  if (!valid) return jsonError(401, 'INVALID_ACCESS_TOKEN', 'Votre session a expiré ou ne peut pas être vérifiée.', false);
  return null;
}

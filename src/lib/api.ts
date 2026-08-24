import type { ApiErrorPayload } from '../shared/contracts';

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiJson<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) throw await toApiError(response, `La requête a échoué (${response.status}).`);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiRequestError('Le serveur met trop de temps à répondre.', 0, 'TIMEOUT', true);
    }
    throw new ApiRequestError('Impossible de joindre le serveur.', 0, 'NETWORK_ERROR', true, error);
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function apiPutBlob(path: string, blob: Blob, mimeType: string, timeoutMs = 60_000): Promise<void> {
  await apiPutBinary<void>(path, blob, mimeType, {}, timeoutMs, false);
}

export async function apiPutBinary<T>(
  path: string,
  blob: Blob,
  mimeType: string,
  headers: Record<string, string> = {},
  timeoutMs = 120_000,
  expectJson = true,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: 'PUT',
      body: blob,
      signal: controller.signal,
      headers: { 'Content-Type': mimeType, ...headers },
    });
    if (!response.ok) throw await toApiError(response, `L’envoi du fichier a échoué (${response.status}).`);
    if (!expectJson || response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiRequestError('L’envoi du fichier a dépassé le délai autorisé.', 0, 'TIMEOUT', true);
    }
    throw new ApiRequestError('Impossible d’envoyer le fichier.', 0, 'NETWORK_ERROR', true, error);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function toApiError(response: Response, fallback: string): Promise<ApiRequestError> {
  const payload = await safeErrorPayload(response);
  return new ApiRequestError(
    payload?.error.message ?? fallback,
    response.status,
    payload?.error.code ?? 'HTTP_ERROR',
    payload?.error.retryable ?? response.status >= 500,
    payload?.error.details,
  );
}

async function safeErrorPayload(response: Response): Promise<ApiErrorPayload | null> {
  try {
    return (await response.json()) as ApiErrorPayload;
  } catch {
    return null;
  }
}

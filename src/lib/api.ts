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

    if (!response.ok) {
      const payload = await safeErrorPayload(response);
      throw new ApiRequestError(
        payload?.error.message ?? `La requête a échoué (${response.status}).`,
        response.status,
        payload?.error.code ?? 'HTTP_ERROR',
        payload?.error.retryable ?? response.status >= 500,
        payload?.error.details,
      );
    }

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
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: 'PUT',
      body: blob,
      signal: controller.signal,
      headers: { 'Content-Type': mimeType },
    });
    if (!response.ok) {
      const payload = await safeErrorPayload(response);
      throw new ApiRequestError(
        payload?.error.message ?? `L’envoi du fichier a échoué (${response.status}).`,
        response.status,
        payload?.error.code ?? 'UPLOAD_ERROR',
        payload?.error.retryable ?? response.status >= 500,
      );
    }
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

async function safeErrorPayload(response: Response): Promise<ApiErrorPayload | null> {
  try {
    return (await response.json()) as ApiErrorPayload;
  } catch {
    return null;
  }
}

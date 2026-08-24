import { buildIdentity } from '../src/buildIdentity';
import app from './index';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/build') {
      return new Response(JSON.stringify(buildIdentity), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store, max-age=0',
        },
      });
    }

    const blobMatch = url.pathname.match(/^\/api\/resource-versions\/([0-9a-f-]+)\/blob$/i);
    if (request.method === 'GET' && blobMatch?.[1]) {
      return getBlobWithRange(blobMatch[1], request, env);
    }
    return app.fetch(request, env);
  },
} satisfies ExportedHandler<Env>;

async function getBlobWithRange(versionId: string, request: Request, env: Env): Promise<Response> {
  const version = await env.DB.prepare('SELECT r2_key, mime_type, file_name FROM resource_versions WHERE id = ?')
    .bind(versionId)
    .first<{ r2_key: string; mime_type: string; file_name: string }>();
  if (!version) return apiError(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);

  const hasRange = request.headers.has('range');
  const object = await env.FILES.get(version.r2_key, hasRange ? { range: request.headers } : undefined);
  if (!object || !('body' in object) || !object.body) {
    return apiError(404, 'FILE_NOT_FOUND', 'Le fichier n’est pas présent dans le stockage.', true);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', headers.get('Content-Type') ?? version.mime_type);
  headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(version.file_name)}`);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');

  if (object.range && 'offset' in object.range && 'length' in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

function apiError(status: number, code: string, message: string, retryable: boolean): Response {
  return new Response(JSON.stringify({ error: { code, message, retryable } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

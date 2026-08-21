import { z } from 'zod';
import {
  ExtractionFailureSchema,
  ExtractionUploadSchema,
  ResourceRegisterSchema,
  SubjectUpsertSchema,
  type ApiErrorPayload,
  type BootstrapPayload,
  type ResourceDetailPayload,
} from '../src/shared/contracts';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export default {
  async fetch(request, env): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return new Response(null, { status: 404 });

      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json({ ok: true, version: '0.1.0' });
      }
      if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
        return getBootstrap(env);
      }
      if (request.method === 'POST' && url.pathname === '/api/subjects/upsert') {
        return upsertSubject(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/resources/register') {
        return registerResource(request, env);
      }

      const resourceMatch = url.pathname.match(/^\/api\/resources\/([0-9a-f-]+)$/i);
      if (request.method === 'GET' && resourceMatch?.[1]) {
        return getResource(resourceMatch[1], env);
      }

      const blobMatch = url.pathname.match(/^\/api\/resource-versions\/([0-9a-f-]+)\/blob$/i);
      if (blobMatch?.[1]) {
        if (request.method === 'PUT') return putBlob(blobMatch[1], request, env);
        if (request.method === 'GET') return getBlob(blobMatch[1], env);
      }

      const extractionMatch = url.pathname.match(/^\/api\/resource-versions\/([0-9a-f-]+)\/extraction$/i);
      if (request.method === 'POST' && extractionMatch?.[1]) {
        return storeExtraction(extractionMatch[1], request, env);
      }

      const failureMatch = url.pathname.match(/^\/api\/resource-versions\/([0-9a-f-]+)\/extraction-failure$/i);
      if (request.method === 'POST' && failureMatch?.[1]) {
        return storeExtractionFailure(failureMatch[1], request, env);
      }

      return errorResponse(404, 'NOT_FOUND', 'Cette route API n’existe pas.', false);
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        requestId,
        message: error instanceof Error ? error.message : 'Unknown Worker error',
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'Une erreur serveur inattendue est survenue.', true);
    }
  },
} satisfies ExportedHandler<Env>;

async function upsertSubject(request: Request, env: Env): Promise<Response> {
  const parsed = SubjectUpsertSchema.safeParse(await safeJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const subject = parsed.data;

  await env.DB.prepare(`
    INSERT INTO subjects (id, name, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      parent_id = excluded.parent_id,
      updated_at = excluded.updated_at
  `).bind(subject.id, subject.name, subject.parentId, subject.createdAt, subject.updatedAt).run();

  return json({ ok: true });
}

async function registerResource(request: Request, env: Env): Promise<Response> {
  const parsed = ResourceRegisterSchema.safeParse(await safeJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const { resource, version } = parsed.data;

  const subject = await env.DB.prepare('SELECT id FROM subjects WHERE id = ?').bind(resource.subjectId).first<{ id: string }>();
  if (!subject) return errorResponse(409, 'SUBJECT_MISSING', 'La matière n’existe pas encore sur le serveur. Réessayez la synchronisation.', true);

  const duplicate = await env.DB.prepare('SELECT id, resource_id FROM resource_versions WHERE sha256 = ?')
    .bind(version.sha256)
    .first<{ id: string; resource_id: string }>();
  if (duplicate && duplicate.id !== version.id) {
    return errorResponse(409, 'DUPLICATE_SUPPORT', 'Ce fichier existe déjà dans la bibliothèque synchronisée.', false, {
      existingResourceId: duplicate.resource_id,
    });
  }

  const r2Key = `resources/${resource.id}/${version.id}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO resources (id, subject_id, title, kind, current_version_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        subject_id = excluded.subject_id,
        title = excluded.title,
        kind = excluded.kind,
        current_version_id = excluded.current_version_id,
        updated_at = excluded.updated_at
    `).bind(
      resource.id,
      resource.subjectId,
      resource.title,
      resource.kind,
      resource.currentVersionId,
      resource.createdAt,
      resource.updatedAt,
    ),
    env.DB.prepare(`
      INSERT INTO resource_versions (
        id, resource_id, sha256, file_name, mime_type, size, r2_key,
        status, extraction_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', 'pending', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        file_name = excluded.file_name,
        mime_type = excluded.mime_type,
        size = excluded.size,
        updated_at = excluded.updated_at
    `).bind(
      version.id,
      version.resourceId,
      version.sha256,
      version.fileName,
      version.mimeType,
      version.size,
      r2Key,
      version.createdAt,
      version.createdAt,
    ),
  ]);

  return json({ ok: true });
}

async function putBlob(versionId: string, request: Request, env: Env): Promise<Response> {
  const version = await env.DB.prepare(`
    SELECT id, r2_key, mime_type, size, sha256, extraction_status
    FROM resource_versions WHERE id = ?
  `).bind(versionId).first<{
    id: string;
    r2_key: string;
    mime_type: string;
    size: number;
    sha256: string;
    extraction_status: 'pending' | 'ready' | 'failed';
  }>();
  if (!version) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);
  if (!request.body) return errorResponse(400, 'EMPTY_UPLOAD', 'Le fichier envoyé est vide.', true);

  const declaredLength = Number(request.headers.get('content-length') ?? version.size);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_FILE_BYTES) {
    return errorResponse(413, 'FILE_TOO_LARGE', 'Le fichier dépasse la limite de 25 Mo.', false);
  }

  const stored = await env.FILES.put(version.r2_key, request.body, {
    httpMetadata: { contentType: request.headers.get('content-type') ?? version.mime_type },
    sha256: version.sha256,
  });
  if (!stored || stored.size !== version.size) {
    await env.FILES.delete(version.r2_key);
    return errorResponse(400, 'UPLOAD_INTEGRITY_ERROR', 'Le fichier reçu ne correspond pas au fichier importé. Il n’a pas été conservé.', true);
  }

  const nextStatus = version.extraction_status === 'ready' ? 'ready' : version.extraction_status === 'failed' ? 'failed' : 'stored';
  await env.DB.prepare('UPDATE resource_versions SET status = ?, updated_at = ? WHERE id = ?')
    .bind(nextStatus, new Date().toISOString(), versionId)
    .run();
  return json({ ok: true });
}

async function getBlob(versionId: string, env: Env): Promise<Response> {
  const version = await env.DB.prepare('SELECT r2_key, mime_type, file_name FROM resource_versions WHERE id = ?')
    .bind(versionId)
    .first<{ r2_key: string; mime_type: string; file_name: string }>();
  if (!version) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);

  const object = await env.FILES.get(version.r2_key);
  if (!object) return errorResponse(404, 'FILE_NOT_FOUND', 'Le fichier n’est pas présent dans le stockage.', true);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', headers.get('Content-Type') ?? version.mime_type);
  headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(version.file_name)}`);
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}

async function storeExtraction(versionId: string, request: Request, env: Env): Promise<Response> {
  const parsed = ExtractionUploadSchema.safeParse(await safeJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const exists = await env.DB.prepare('SELECT id FROM resource_versions WHERE id = ?').bind(versionId).first<{ id: string }>();
  if (!exists) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);

  const computedCharCount = parsed.data.pages.reduce((sum, page) => sum + page.text.length, 0);
  if (computedCharCount !== parsed.data.charCount) {
    return errorResponse(400, 'CHAR_COUNT_MISMATCH', 'Le contenu extrait est incohérent ; il n’a pas été enregistré.', true);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO extractions (version_id, content_json, char_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(version_id) DO UPDATE SET
        content_json = excluded.content_json,
        char_count = excluded.char_count,
        updated_at = excluded.updated_at
    `).bind(versionId, JSON.stringify(parsed.data.pages), computedCharCount, now, now),
    env.DB.prepare(`
      UPDATE resource_versions
      SET extraction_status = 'ready', extraction_error = NULL, status = 'ready', updated_at = ?
      WHERE id = ?
    `).bind(now, versionId),
  ]);
  return json({ ok: true });
}

async function storeExtractionFailure(versionId: string, request: Request, env: Env): Promise<Response> {
  const parsed = ExtractionFailureSchema.safeParse(await safeJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE resource_versions
    SET extraction_status = 'failed', extraction_error = ?, status = 'failed', updated_at = ?
    WHERE id = ?
  `).bind(`${parsed.data.code}: ${parsed.data.message}`, now, versionId).run();
  if (!result.meta.changes) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);
  return json({ ok: true });
}

async function getBootstrap(env: Env): Promise<Response> {
  const [subjectsResult, resourcesResult] = await Promise.all([
    env.DB.prepare('SELECT id, name, parent_id, created_at, updated_at FROM subjects ORDER BY name COLLATE NOCASE').all<{
      id: string;
      name: string;
      parent_id: string | null;
      created_at: string;
      updated_at: string;
    }>(),
    env.DB.prepare(`
      SELECT r.id, r.subject_id, r.title, r.kind, r.current_version_id,
             r.created_at, r.updated_at, v.status, e.char_count
      FROM resources r
      JOIN resource_versions v ON v.id = r.current_version_id
      LEFT JOIN extractions e ON e.version_id = v.id
      ORDER BY r.updated_at DESC
    `).all<{
      id: string;
      subject_id: string;
      title: string;
      kind: 'text' | 'pdf';
      current_version_id: string;
      created_at: string;
      updated_at: string;
      status: 'uploading' | 'stored' | 'ready' | 'failed';
      char_count: number | null;
    }>(),
  ]);

  const payload: BootstrapPayload = {
    subjects: subjectsResult.results.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    resources: resourcesResult.results.map((row) => ({
      id: row.id,
      subjectId: row.subject_id,
      title: row.title,
      kind: row.kind,
      currentVersionId: row.current_version_id,
      status: row.status,
      extractionCharCount: row.char_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
  return json(payload);
}

async function getResource(resourceId: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`
    SELECT r.id, r.subject_id, r.title, r.kind, r.current_version_id, r.created_at, r.updated_at,
           v.file_name, v.mime_type, v.size, v.sha256, v.status, v.extraction_status, v.extraction_error,
           e.content_json, e.char_count
    FROM resources r
    JOIN resource_versions v ON v.id = r.current_version_id
    LEFT JOIN extractions e ON e.version_id = v.id
    WHERE r.id = ?
  `).bind(resourceId).first<{
    id: string;
    subject_id: string;
    title: string;
    kind: 'text' | 'pdf';
    current_version_id: string;
    created_at: string;
    updated_at: string;
    file_name: string;
    mime_type: string;
    size: number;
    sha256: string;
    status: 'uploading' | 'stored' | 'ready' | 'failed';
    extraction_status: 'pending' | 'ready' | 'failed';
    extraction_error: string | null;
    content_json: string | null;
    char_count: number | null;
  }>();
  if (!row) return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Ce support est introuvable.', false);

  const payload: ResourceDetailPayload = {
    resource: {
      id: row.id,
      subjectId: row.subject_id,
      title: row.title,
      kind: row.kind,
      currentVersionId: row.current_version_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    version: {
      id: row.current_version_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      size: row.size,
      sha256: row.sha256,
      status: row.status,
      extractionStatus: row.extraction_status,
      extractionError: row.extraction_error,
    },
    extraction: row.content_json && row.char_count !== null
      ? { pages: JSON.parse(row.content_json), charCount: row.char_count }
      : null,
  };
  return json(payload);
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validationError(error: z.ZodError): Response {
  return errorResponse(400, 'VALIDATION_ERROR', 'Les données envoyées sont invalides.', false, error.issues);
}

function errorResponse(status: number, code: string, message: string, retryable: boolean, details?: unknown): Response {
  const payload: ApiErrorPayload = { error: { code, message, retryable, ...(details === undefined ? {} : { details }) } };
  return json(payload, status);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

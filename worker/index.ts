import { z } from 'zod';
import {
  ExtractionFailureSchema,
  ExtractionUploadSchema,
  MultipartCompleteSchema,
  MultipartCreateSchema,
  ResourceRegisterSchema,
  SubjectUpsertSchema,
  type ApiErrorPayload,
  type BootstrapPayload,
  type ExtractedPage,
  type MultipartCreateResult,
  type ResourceDetailPayload,
  type ResourceRegisterResult,
  type ServerExtractionResult,
  type UploadedPart,
} from '../src/shared/contracts';
import {
  MAX_EXTRACTED_CHARS,
  MAX_SINGLE_UPLOAD_BYTES,
  MULTIPART_UPLOAD_THRESHOLD_BYTES,
  SERVER_PDF_EXTRACTION_MAX_BYTES,
  SERVER_TEXT_EXTRACTION_MAX_BYTES,
} from '../src/shared/importPolicy';
import { extractTextContent, TextExtractionError } from '../src/lib/textExtraction';

type WorkerEnv = Env;

const LEGACY_D1_SIZE_LIMIT = 25 * 1024 * 1024;

export default {
  async fetch(request, env): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return new Response(null, { status: 404 });

      if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true, version: '0.1.0' });
      if (request.method === 'GET' && url.pathname === '/api/bootstrap') return getBootstrap(env);
      if (request.method === 'POST' && url.pathname === '/api/subjects/upsert') return upsertSubject(request, env);
      if (request.method === 'POST' && url.pathname === '/api/resources/register') return registerResource(request, env);

      const resourceMatch = url.pathname.match(/^\/api\/resources\/([0-9a-f-]+)$/i);
      if (request.method === 'GET' && resourceMatch?.[1]) return getResource(resourceMatch[1], env);

      const blobMatch = url.pathname.match(/^\/api\/resource-versions\/([0-9a-f-]+)\/blob$/i);
      if (blobMatch?.[1]) {
        if (request.method === 'PUT') return putBlob(blobMatch[1], request, env);
        if (request.method === 'GET') return getBlob(blobMatch[1], request, env);
      }

      const multipartMatch = url.pathname.match(/^\/api\/resource-versions\/([0-9a-f-]+)\/multipart\/(create|part|complete)$/i);
      if (multipartMatch?.[1] && multipartMatch[2]) {
        const versionId = multipartMatch[1];
        const action = multipartMatch[2].toLowerCase();
        if (request.method === 'POST' && action === 'create') return createMultipart(versionId, request, env);
        if (request.method === 'PUT' && action === 'part') return uploadMultipartPart(versionId, request, env);
        if (request.method === 'POST' && action === 'complete') return completeMultipart(versionId, request, env);
      }

      const serverExtractionMatch = url.pathname.match(/^\/api\/resource-versions\/([0-9a-f-]+)\/server-extraction$/i);
      if (request.method === 'POST' && serverExtractionMatch?.[1]) return extractOnServer(serverExtractionMatch[1], env);

      const extractionMatch = url.pathname.match(/^\/api\/resource-versions\/([0-9a-f-]+)\/extraction$/i);
      if (request.method === 'POST' && extractionMatch?.[1]) return storeExtraction(extractionMatch[1], request, env);

      const failureMatch = url.pathname.match(/^\/api\/resource-versions\/([0-9a-f-]+)\/extraction-failure$/i);
      if (request.method === 'POST' && failureMatch?.[1]) return storeExtractionFailure(failureMatch[1], request, env);

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
} satisfies ExportedHandler<WorkerEnv>;

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

export async function registerResource(request: Request, env: Env): Promise<Response> {
  const parsed = ResourceRegisterSchema.safeParse(await safeJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const { resource, version } = parsed.data;

  const subject = await env.DB.prepare('SELECT id FROM subjects WHERE id = ?').bind(resource.subjectId).first<{ id: string }>();
  if (!subject) return errorResponse(409, 'SUBJECT_MISSING', 'La matière n’existe pas encore sur le serveur. Réessayez la synchronisation.', true);

  const duplicate = await env.DB.prepare('SELECT id, resource_id, extraction_status FROM resource_versions WHERE sha256 = ?')
    .bind(version.sha256)
    .first<{ id: string; resource_id: string; extraction_status: VersionUploadRow['extraction_status'] }>();
  if (duplicate && duplicate.id !== version.id) {
    return errorResponse(409, 'DUPLICATE_SUPPORT', 'Ce fichier existe déjà dans la bibliothèque synchronisée.', false, {
      existingResourceId: duplicate.resource_id,
    });
  }

  const r2Key = `resources/${resource.id}/${version.id}`;
  const legacySize = Math.min(version.size, LEGACY_D1_SIZE_LIMIT);
  const uploadMode = version.size > MULTIPART_UPLOAD_THRESHOLD_BYTES ? 'multipart' : 'single';
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
    `).bind(resource.id, resource.subjectId, resource.title, resource.kind, resource.currentVersionId, resource.createdAt, resource.updatedAt),
    env.DB.prepare(`
      INSERT INTO resource_versions (
        id, resource_id, sha256, file_name, mime_type, size, size_bytes, r2_key,
        status, extraction_status, upload_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 'pending', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        file_name = excluded.file_name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        upload_mode = excluded.upload_mode,
        updated_at = excluded.updated_at
    `).bind(
      version.id,
      version.resourceId,
      version.sha256,
      version.fileName,
      version.mimeType,
      legacySize,
      version.size,
      r2Key,
      uploadMode,
      version.createdAt,
      version.createdAt,
    ),
  ]);

  let alreadyStored = false;
  if (uploadMode === 'single' && duplicate?.id === version.id) {
    // A retry of the same version can arrive after R2 durably accepted the
    // object but before D1 recorded "stored". R2 HEAD is strongly consistent;
    // only trust the object when both size and the persisted SHA-256 checksum
    // match the version identity exactly.
    const stored = await env.FILES.head(r2Key);
    if (matchesStoredSingleObject(stored, version.size, version.sha256)) {
      await markVersionStored(version.id, duplicate.extraction_status, env);
      alreadyStored = true;
    }
  }

  const result: ResourceRegisterResult = { ok: true, uploadMode, alreadyStored };
  return json(result);
}

async function putBlob(versionId: string, request: Request, env: Env): Promise<Response> {
  const version = await getVersionUploadRow(versionId, env);
  if (!version) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);
  if (!request.body) return errorResponse(400, 'EMPTY_UPLOAD', 'Le fichier envoyé est vide.', true);
  if (version.size > MAX_SINGLE_UPLOAD_BYTES) {
    return errorResponse(413, 'MULTIPART_REQUIRED', 'Ce fichier doit être envoyé par morceaux.', false);
  }

  const declaredLength = Number(request.headers.get('content-length') ?? version.size);
  if (!Number.isFinite(declaredLength) || declaredLength !== version.size) {
    return errorResponse(400, 'UPLOAD_SIZE_MISMATCH', 'La taille du fichier envoyé ne correspond pas au support enregistré.', true);
  }

  const stored = await env.FILES.put(version.r2_key, request.body, {
    httpMetadata: { contentType: request.headers.get('content-type') ?? version.mime_type },
    sha256: version.sha256,
  });
  if (!stored || stored.size !== version.size) {
    await env.FILES.delete(version.r2_key);
    return errorResponse(400, 'UPLOAD_INTEGRITY_ERROR', 'Le fichier reçu ne correspond pas au fichier importé. Il n’a pas été conservé.', true);
  }

  await markVersionStored(versionId, version.extraction_status, env);
  return json({ ok: true });
}

async function createMultipart(versionId: string, request: Request, env: Env): Promise<Response> {
  const parsed = MultipartCreateSchema.safeParse(await safeJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const version = await getVersionUploadRow(versionId, env);
  if (!version) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);
  if (version.size <= MULTIPART_UPLOAD_THRESHOLD_BYTES) {
    return errorResponse(400, 'MULTIPART_NOT_REQUIRED', 'Ce fichier peut utiliser l’envoi standard.', false);
  }

  if (version.multipart_upload_id && !parsed.data.restart) {
    const payload: MultipartCreateResult = {
      uploadId: version.multipart_upload_id,
      partSize: version.multipart_part_size || parsed.data.partSize,
      parts: parseUploadedParts(version.multipart_parts_json),
    };
    return json(payload);
  }

  if (version.multipart_upload_id && parsed.data.restart) {
    try {
      await env.FILES.resumeMultipartUpload(version.r2_key, version.multipart_upload_id).abort();
    } catch {
      // An expired/aborted session is already clean from the client's point of view.
    }
  }

  const upload = await env.FILES.createMultipartUpload(version.r2_key, {
    httpMetadata: { contentType: version.mime_type },
    customMetadata: { sha256: version.sha256 },
  });
  await env.DB.prepare(`
    UPDATE resource_versions
    SET upload_mode = 'multipart', multipart_upload_id = ?, multipart_part_size = ?,
        multipart_parts_json = '[]', status = 'uploading', updated_at = ?
    WHERE id = ?
  `).bind(upload.uploadId, parsed.data.partSize, new Date().toISOString(), versionId).run();

  const payload: MultipartCreateResult = { uploadId: upload.uploadId, partSize: parsed.data.partSize, parts: [] };
  return json(payload);
}

export async function uploadMultipartPart(versionId: string, request: Request, env: Env): Promise<Response> {
  const version = await getVersionUploadRow(versionId, env);
  if (!version) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);
  const url = new URL(request.url);
  const uploadId = url.searchParams.get('uploadId');
  const partNumber = Number(url.searchParams.get('partNumber'));
  if (!uploadId || uploadId !== version.multipart_upload_id || !Number.isInteger(partNumber) || partNumber < 1) {
    return errorResponse(400, 'INVALID_MULTIPART_PART', 'La session ou le numéro de morceau est invalide.', false);
  }
  if (!request.body || !version.multipart_part_size) {
    return errorResponse(400, 'EMPTY_MULTIPART_PART', 'Le morceau envoyé est vide ou la session est incomplète.', true);
  }

  const totalParts = Math.ceil(version.size / version.multipart_part_size);
  if (partNumber > totalParts) return errorResponse(400, 'INVALID_MULTIPART_PART', 'Ce numéro de morceau dépasse le fichier.', false);
  const expectedSize = partNumber === totalParts
    ? version.size - version.multipart_part_size * (totalParts - 1)
    : version.multipart_part_size;
  const declaredSize = Number(request.headers.get('x-sirafiq-part-size'));
  if (!Number.isFinite(declaredSize) || declaredSize !== expectedSize) {
    return errorResponse(400, 'MULTIPART_PART_SIZE_MISMATCH', 'La taille du morceau ne correspond pas à la session.', true);
  }

  let uploaded: UploadedPart;
  try {
    const upload = env.FILES.resumeMultipartUpload(version.r2_key, uploadId);
    uploaded = await upload.uploadPart(partNumber, request.body);
  } catch (error) {
    return errorResponse(409, 'MULTIPART_SESSION_INVALID', error instanceof Error ? error.message : 'La session multipart n’est plus valide.', true);
  }

  const parts = mergeUploadedPart(parseUploadedParts(version.multipart_parts_json), uploaded);
  try {
    await env.DB.prepare('UPDATE resource_versions SET multipart_parts_json = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(parts), new Date().toISOString(), versionId)
      .run();
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      operation: 'multipart-part-state',
      versionId,
      partNumber,
      message: error instanceof Error ? error.message : 'Unknown D1 multipart part persistence error',
    }));
    return errorResponse(
      503,
      'MULTIPART_PART_STATE_FAILED',
      'Le morceau a été reçu par R2, mais son état n’a pas pu être confirmé. Réessayez ce morceau sans redémarrer la session.',
      true,
    );
  }

  return json(uploaded);
}

async function completeMultipart(versionId: string, request: Request, env: Env): Promise<Response> {
  const parsed = MultipartCompleteSchema.safeParse(await safeJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const version = await getVersionUploadRow(versionId, env);
  if (!version) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);
  if (!version.multipart_upload_id || parsed.data.uploadId !== version.multipart_upload_id || !version.multipart_part_size) {
    return errorResponse(400, 'INVALID_MULTIPART_SESSION', 'La session multipart ne correspond pas à ce support.', false);
  }

  const parts = parseUploadedParts(version.multipart_parts_json);
  const totalParts = Math.ceil(version.size / version.multipart_part_size);
  if (parts.length !== totalParts || parts.some((part, index) => part.partNumber !== index + 1)) {
    return errorResponse(409, 'MULTIPART_INCOMPLETE', 'Tous les morceaux du fichier n’ont pas encore été envoyés.', true, {
      received: parts.length,
      expected: totalParts,
    });
  }

  try {
    // R2 completion and the following D1 update are not atomic. A previous
    // request may therefore have finalized the object while D1 still reports
    // "uploading". R2 is strongly consistent after complete(), so repair D1
    // from the exact object identity before touching the old multipart id.
    const recovered = await recoverCompletedMultipartObject(versionId, version, env);
    if (recovered) {
      return json({ ok: true, size: recovered.size, etag: recovered.httpEtag, recovered: true });
    }

    const upload = env.FILES.resumeMultipartUpload(version.r2_key, version.multipart_upload_id);
    const object = await upload.complete(parts);
    if (object.size !== version.size) {
      await env.FILES.delete(version.r2_key);
      return errorResponse(400, 'UPLOAD_INTEGRITY_ERROR', 'Le fichier assemblé n’a pas la taille attendue et a été supprimé.', true);
    }
    await markMultipartComplete(versionId, version.extraction_status, env);
    return json({ ok: true, size: object.size, etag: object.httpEtag });
  } catch (error) {
    // complete() can have committed in R2 even when the request later failed
    // (for example while persisting the final status in D1). Check the object
    // once more before telling the client to restart a large transfer.
    try {
      const recovered = await recoverCompletedMultipartObject(versionId, version, env);
      if (recovered) {
        return json({ ok: true, size: recovered.size, etag: recovered.httpEtag, recovered: true });
      }
    } catch (recoveryError) {
      console.error(JSON.stringify({
        level: 'error',
        operation: 'multipart-finalization-recovery',
        versionId,
        message: recoveryError instanceof Error ? recoveryError.message : 'Unknown multipart recovery error',
      }));
    }
    return errorResponse(409, 'MULTIPART_COMPLETE_FAILED', error instanceof Error ? error.message : 'L’assemblage final du fichier a échoué.', true);
  }
}

export function matchesStoredSingleObject(
  object: { size: number; checksums?: { sha256?: ArrayBuffer } } | null,
  expectedSize: number,
  expectedSha256: string,
): boolean {
  const checksum = object?.checksums?.sha256;
  return Boolean(
    object
    && object.size === expectedSize
    && checksum
    && arrayBufferToHex(checksum) === expectedSha256,
  );
}

function arrayBufferToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function matchesCompletedMultipartObject(
  object: { size: number; customMetadata?: Record<string, string> } | null,
  expectedSize: number,
  expectedSha256: string,
): boolean {
  return Boolean(
    object
    && object.size === expectedSize
    && object.customMetadata?.sha256 === expectedSha256,
  );
}

async function recoverCompletedMultipartObject(
  versionId: string,
  version: VersionUploadRow,
  env: Env,
) {
  const object = await env.FILES.head(version.r2_key);
  if (!matchesCompletedMultipartObject(object, version.size, version.sha256)) return null;
  await markMultipartComplete(versionId, version.extraction_status, env);
  return object;
}

async function markMultipartComplete(
  versionId: string,
  extractionStatus: VersionUploadRow['extraction_status'],
  env: Env,
): Promise<void> {
  await env.DB.prepare(`
    UPDATE resource_versions
    SET status = ?, multipart_upload_id = NULL, multipart_part_size = NULL,
        multipart_parts_json = NULL, updated_at = ?
    WHERE id = ?
  `).bind(
    extractionStatus === 'ready' ? 'ready' : extractionStatus === 'failed' ? 'failed' : 'stored',
    new Date().toISOString(),
    versionId,
  ).run();
}

export type ByteRange = { offset: number; length: number };

export function parseByteRange(header: string | null, totalSize: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  if (!Number.isSafeInteger(totalSize) || totalSize < 0) return 'invalid';
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return 'invalid';

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || totalSize === 0) return 'invalid';
    const length = Math.min(suffix, totalSize);
    return { offset: totalSize - length, length };
  }

  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) return 'invalid';
  const requestedEnd = match[2] ? Number(match[2]) : totalSize - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return 'invalid';
  const end = Math.min(requestedEnd, totalSize - 1);
  return { offset: start, length: end - start + 1 };
}

export function createUnsatisfiableRangeResponse(totalSize: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${totalSize}`,
    },
  });
}

export function createBlobResponse(
  body: ReadableStream<Uint8Array>,
  headers: Headers,
  fullSize: number,
  range: (ByteRange & { totalSize: number }) | null,
): Response {
  headers.set('Accept-Ranges', 'bytes');
  if (range) {
    const end = range.offset + range.length - 1;
    headers.set('Content-Length', String(range.length));
    headers.set('Content-Range', `bytes ${range.offset}-${end}/${range.totalSize}`);
    return new Response(body, { status: 206, headers });
  }

  headers.delete('Content-Range');
  headers.set('Content-Length', String(fullSize));
  return new Response(body, { status: 200, headers });
}

function detachR2Body(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

async function getBlob(versionId: string, request: Request, env: Env): Promise<Response> {
  const version = await env.DB.prepare('SELECT r2_key, mime_type, file_name, COALESCE(size_bytes, size) AS total_size FROM resource_versions WHERE id = ?')
    .bind(versionId)
    .first<{ r2_key: string; mime_type: string; file_name: string; total_size: number }>();
  if (!version) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);

  const rangeHeader = request.headers.get('range');
  let range: ByteRange | null = null;
  let totalSize: number | null = null;
  if (rangeHeader) {
    const metadata = await env.FILES.head(version.r2_key);
    if (!metadata) return errorResponse(404, 'FILE_NOT_FOUND', 'Le fichier n’est pas présent dans le stockage.', true);
    // D1 stores the expected full size and uploads are only marked stored after
    // R2 reports that exact size. The local R2 adapter can expose range-scoped
    // metadata after partial reads, so HTTP satisfiability must use this durable
    // full-object size rather than mutable adapter metadata.
    totalSize = version.total_size;
    const parsedRange = parseByteRange(rangeHeader, totalSize);
    if (parsedRange === 'invalid') return createUnsatisfiableRangeResponse(totalSize);
    range = parsedRange;
  }

  const object = range
    ? await env.FILES.get(version.r2_key, { range })
    : await env.FILES.get(version.r2_key);
  if (!object) return errorResponse(404, 'FILE_NOT_FOUND', 'Le fichier n’est pas présent dans le stockage.', true);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', headers.get('Content-Type') ?? version.mime_type);
  headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(version.file_name)}`);
  headers.set('ETag', object.httpEtag);

  if (range && totalSize !== null) {
    const returnedRange = object.range;
    const offset = returnedRange && 'offset' in returnedRange && typeof returnedRange.offset === 'number'
      ? returnedRange.offset
      : range.offset;
    const length = returnedRange && 'length' in returnedRange && typeof returnedRange.length === 'number'
      ? returnedRange.length
      : range.length;
    return createBlobResponse(object.body, headers, object.size, { offset, length, totalSize });
  }

  return createBlobResponse(detachR2Body(object.body), headers, object.size, null);
}

async function extractOnServer(versionId: string, env: WorkerEnv): Promise<Response> {
  const version = await env.DB.prepare(`
    SELECT v.r2_key, v.mime_type, v.file_name, COALESCE(v.size_bytes, v.size) AS size, r.kind
    FROM resource_versions v
    JOIN resources r ON r.id = v.resource_id
    WHERE v.id = ?
  `).bind(versionId).first<{ r2_key: string; mime_type: string; file_name: string; size: number; kind: string }>();
  if (!version) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);

  if (version.kind !== 'pdf' && version.kind !== 'text') {
    return errorResponse(400, 'UNSUPPORTED_SERVER_EXTRACTION', 'Ce format ne peut pas être extrait par le serveur dans cette version.', false);
  }
  const isPdf = version.kind === 'pdf';
  const isText = version.kind === 'text';

  const maxBytes = isPdf ? SERVER_PDF_EXTRACTION_MAX_BYTES : SERVER_TEXT_EXTRACTION_MAX_BYTES;
  if (version.size > maxBytes) {
    return errorResponse(
      413,
      'SERVER_EXTRACTION_TOO_LARGE',
      `L’extraction serveur est limitée à ${Math.round(maxBytes / (1024 * 1024))} Mo pour ce type de support.`,
      false,
    );
  }

  const object = await env.FILES.get(version.r2_key);
  if (!object) return errorResponse(409, 'FILE_NOT_STORED', 'Le fichier doit d’abord être synchronisé avant une extraction serveur.', true);

  if (isText) {
    try {
      const extracted = extractTextContent((await object.text()).replace(/\u0000/g, ''));
      await persistReadyExtraction(versionId, extracted.pages, extracted.charCount, env);
      const payload: ServerExtractionResult = {
        status: 'ready',
        pages: extracted.pages,
        charCount: extracted.charCount,
      };
      return json(payload);
    } catch (error) {
      if (error instanceof TextExtractionError) {
        return persistServerExtractionFailure(versionId, error.code, error.message, env);
      }
      console.error(JSON.stringify({
        level: 'error',
        operation: 'server-text-extraction',
        versionId,
        message: error instanceof Error ? error.message : 'Unknown text extraction error',
      }));
      return persistServerExtractionFailure(
        versionId,
        'SERVER_EXTRACTION_FAILED',
        'L’extraction serveur du texte a échoué. Le fichier reste conservé.',
        env,
      );
    }
  }

  const ai = env.AI;
  if (!ai) return errorResponse(503, 'SERVER_EXTRACTION_UNAVAILABLE', 'L’extraction PDF serveur n’est pas disponible dans cet environnement.', true);

  try {
    const converted = await ai.toMarkdown(
      { name: version.file_name, blob: new Blob([await object.arrayBuffer()], { type: 'application/pdf' }) },
      { conversionOptions: { output: { format: 'text' }, pdf: { metadata: false } } },
    );
    const result = (Array.isArray(converted) ? converted[0] : converted) as
      | { format: 'markdown' | 'text' | 'error'; data?: string; error?: string }
      | undefined;
    if (!result || result.format === 'error') {
      return persistServerExtractionFailure(versionId, 'SERVER_EXTRACTION_FAILED', result?.error || 'Le service d’extraction n’a pas pu interpréter ce PDF.', env);
    }

    const text = (result.data ?? '').replace(/\u0000/g, '').trim();
    if (text.replace(/\s/g, '').length < 20) {
      return persistServerExtractionFailure(versionId, 'EMPTY_SERVER_EXTRACTION', 'Le service d’extraction n’a trouvé aucun texte exploitable dans ce PDF.', env);
    }
    if (text.length > MAX_EXTRACTED_CHARS) {
      return persistServerExtractionFailure(versionId, 'SERVER_EXTRACTION_TOO_LONG', 'Le texte extrait dépasse la capacité de stockage textuel de cette première version.', env);
    }

    const pages = splitIntoTextBlocks(text);
    const charCount = pages.reduce((sum, page) => sum + page.text.length, 0);
    await persistReadyExtraction(versionId, pages, charCount, env);
    const payload: ServerExtractionResult = { status: 'ready', pages, charCount };
    return json(payload);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', operation: 'server-pdf-extraction', versionId, message: error instanceof Error ? error.message : 'Unknown toMarkdown error' }));
    return persistServerExtractionFailure(versionId, 'SERVER_EXTRACTION_FAILED', 'L’extraction serveur du PDF a échoué. Le fichier reste conservé et consultable.', env);
  }
}

async function storeExtraction(versionId: string, request: Request, env: Env): Promise<Response> {
  const parsed = ExtractionUploadSchema.safeParse(await safeJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const exists = await env.DB.prepare('SELECT id FROM resource_versions WHERE id = ?').bind(versionId).first<{ id: string }>();
  if (!exists) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);
  const computedCharCount = parsed.data.pages.reduce((sum, page) => sum + page.text.length, 0);
  if (computedCharCount !== parsed.data.charCount) return errorResponse(400, 'CHAR_COUNT_MISMATCH', 'Le contenu extrait est incohérent ; il n’a pas été enregistré.', true);
  await persistReadyExtraction(versionId, parsed.data.pages, computedCharCount, env);
  return json({ ok: true });
}

async function storeExtractionFailure(versionId: string, request: Request, env: Env): Promise<Response> {
  const parsed = ExtractionFailureSchema.safeParse(await safeJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const changed = await persistExtractionFailure(versionId, parsed.data.code, parsed.data.message, env);
  if (!changed) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);
  return json({ ok: true });
}

async function persistReadyExtraction(versionId: string, pages: ExtractedPage[], charCount: number, env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO extractions (version_id, content_json, char_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(version_id) DO UPDATE SET content_json = excluded.content_json, char_count = excluded.char_count, updated_at = excluded.updated_at
    `).bind(versionId, JSON.stringify(pages), charCount, now, now),
    env.DB.prepare(`UPDATE resource_versions SET extraction_status = 'ready', extraction_error = NULL, status = 'ready', updated_at = ? WHERE id = ?`).bind(now, versionId),
  ]);
}

async function persistExtractionFailure(versionId: string, code: string, message: string, env: Env): Promise<boolean> {
  const now = new Date().toISOString();
  const [versionResult] = await env.DB.batch([
    env.DB.prepare(`
      UPDATE resource_versions SET extraction_status = 'failed', extraction_error = ?, status = 'failed', updated_at = ? WHERE id = ?
    `).bind(`${code}: ${message}`, now, versionId),
    env.DB.prepare('DELETE FROM extractions WHERE version_id = ?').bind(versionId),
  ]);
  return Boolean(versionResult?.meta.changes);
}

async function persistServerExtractionFailure(versionId: string, code: string, message: string, env: Env): Promise<Response> {
  const changed = await persistExtractionFailure(versionId, code, message, env);
  if (!changed) return errorResponse(404, 'VERSION_NOT_FOUND', 'La version du support est introuvable.', false);
  const payload: ServerExtractionResult = { status: 'failed', code, message };
  return json(payload);
}

function splitIntoTextBlocks(text: string): ExtractedPage[] {
  const blocks: ExtractedPage[] = [];
  let offset = 0;
  const target = 180_000;
  while (offset < text.length) {
    let end = Math.min(offset + target, text.length);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      const wordBreak = text.lastIndexOf(' ', end);
      const candidate = paragraphBreak > offset + target / 2 ? paragraphBreak : wordBreak;
      if (candidate > offset + target / 2) end = candidate;
    }
    const block = text.slice(offset, end).trim();
    if (block) blocks.push({ pageNumber: blocks.length + 1, text: block });
    offset = end;
    while (offset < text.length && /\s/.test(text[offset] ?? '')) offset += 1;
  }
  return blocks;
}

async function getBootstrap(env: Env): Promise<Response> {
  const [subjectsResult, resourcesResult] = await Promise.all([
    env.DB.prepare('SELECT id, name, parent_id, created_at, updated_at FROM subjects ORDER BY name COLLATE NOCASE').all<{
      id: string; name: string; parent_id: string | null; created_at: string; updated_at: string;
    }>(),
    env.DB.prepare(`
      SELECT r.id, r.subject_id, r.title, r.kind, r.current_version_id, r.created_at, r.updated_at, v.status,
             CASE WHEN v.extraction_status = 'ready' THEN e.char_count ELSE NULL END AS char_count
      FROM resources r JOIN resource_versions v ON v.id = r.current_version_id
      LEFT JOIN extractions e ON e.version_id = v.id ORDER BY r.updated_at DESC
    `).all<{
      id: string; subject_id: string; title: string; kind: 'text' | 'pdf'; current_version_id: string;
      created_at: string; updated_at: string; status: 'uploading' | 'stored' | 'ready' | 'failed'; char_count: number | null;
    }>(),
  ]);
  const payload: BootstrapPayload = {
    subjects: subjectsResult.results.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id, createdAt: row.created_at, updatedAt: row.updated_at })),
    resources: resourcesResult.results.map((row) => ({
      id: row.id, subjectId: row.subject_id, title: row.title, kind: row.kind, currentVersionId: row.current_version_id,
      status: row.status, extractionCharCount: row.char_count, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
  };
  return json(payload);
}

async function getResource(resourceId: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`
    SELECT r.id, r.subject_id, r.title, r.kind, r.current_version_id, r.created_at, r.updated_at,
           s.name AS subject_name, s.parent_id AS subject_parent_id,
           s.created_at AS subject_created_at, s.updated_at AS subject_updated_at,
           v.file_name, v.mime_type, COALESCE(v.size_bytes, v.size) AS size, v.sha256, v.status,
           v.extraction_status, v.extraction_error, e.content_json, e.char_count
    FROM resources r
    JOIN subjects s ON s.id = r.subject_id
    JOIN resource_versions v ON v.id = r.current_version_id
    LEFT JOIN extractions e ON e.version_id = v.id WHERE r.id = ?
  `).bind(resourceId).first<{
    id: string; subject_id: string; title: string; kind: 'text' | 'pdf'; current_version_id: string;
    created_at: string; updated_at: string; subject_name: string; subject_parent_id: string | null;
    subject_created_at: string; subject_updated_at: string; file_name: string; mime_type: string; size: number; sha256: string;
    status: 'uploading' | 'stored' | 'ready' | 'failed'; extraction_status: 'pending' | 'ready' | 'failed';
    extraction_error: string | null; content_json: string | null; char_count: number | null;
  }>();
  if (!row) return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Ce support est introuvable.', false);
  const payload: ResourceDetailPayload = {
    subject: {
      id: row.subject_id,
      name: row.subject_name,
      parentId: row.subject_parent_id,
      createdAt: row.subject_created_at,
      updatedAt: row.subject_updated_at,
    },
    resource: { id: row.id, subjectId: row.subject_id, title: row.title, kind: row.kind, currentVersionId: row.current_version_id, createdAt: row.created_at, updatedAt: row.updated_at },
    version: {
      id: row.current_version_id, fileName: row.file_name, mimeType: row.mime_type, size: row.size, sha256: row.sha256,
      status: row.status, extractionStatus: row.extraction_status, extractionError: row.extraction_error,
    },
    extraction: row.extraction_status === 'ready' && row.content_json && row.char_count !== null
      ? { pages: JSON.parse(row.content_json), charCount: row.char_count }
      : null,
  };
  return json(payload);
}

type VersionUploadRow = {
  id: string;
  r2_key: string;
  mime_type: string;
  size: number;
  sha256: string;
  extraction_status: 'pending' | 'ready' | 'failed';
  multipart_upload_id: string | null;
  multipart_part_size: number | null;
  multipart_parts_json: string | null;
};

async function getVersionUploadRow(versionId: string, env: Env): Promise<VersionUploadRow | null> {
  return env.DB.prepare(`
    SELECT id, r2_key, mime_type, COALESCE(size_bytes, size) AS size, sha256, extraction_status,
           multipart_upload_id, multipart_part_size, multipart_parts_json
    FROM resource_versions WHERE id = ?
  `).bind(versionId).first<VersionUploadRow>();
}

function parseUploadedParts(value: string | null): UploadedPart[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is UploadedPart => Boolean(item && typeof item === 'object' && Number.isInteger((item as UploadedPart).partNumber) && typeof (item as UploadedPart).etag === 'string'))
      .sort((a, b) => a.partNumber - b.partNumber);
  } catch {
    return [];
  }
}

function mergeUploadedPart(parts: UploadedPart[], next: UploadedPart): UploadedPart[] {
  return [...parts.filter((part) => part.partNumber !== next.partNumber), next].sort((a, b) => a.partNumber - b.partNumber);
}

async function markVersionStored(versionId: string, extractionStatus: VersionUploadRow['extraction_status'], env: Env): Promise<void> {
  const nextStatus = extractionStatus === 'ready' ? 'ready' : extractionStatus === 'failed' ? 'failed' : 'stored';
  await env.DB.prepare('UPDATE resource_versions SET status = ?, updated_at = ? WHERE id = ?')
    .bind(nextStatus, new Date().toISOString(), versionId).run();
}

async function safeJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
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
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

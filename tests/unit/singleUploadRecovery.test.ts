import { describe, expect, it } from 'vitest';
import { matchesStoredSingleObject, registerResource } from '../../worker/index';

describe('single upload R2 recovery', () => {
  it('accepts only the exact R2 object identified by size and SHA-256', () => {
    const expectedSha = 'ab'.repeat(32);
    const checksum = Uint8Array.from({ length: 32 }, () => 0xab).buffer;

    expect(matchesStoredSingleObject({
      size: 42,
      checksums: { sha256: checksum },
    }, 42, expectedSha)).toBe(true);

    expect(matchesStoredSingleObject({
      size: 41,
      checksums: { sha256: checksum },
    }, 42, expectedSha)).toBe(false);

    expect(matchesStoredSingleObject({
      size: 42,
      checksums: { sha256: Uint8Array.from({ length: 32 }, () => 0xcd).buffer },
    }, 42, expectedSha)).toBe(false);

    expect(matchesStoredSingleObject({ size: 42, checksums: {} }, 42, expectedSha)).toBe(false);
    expect(matchesStoredSingleObject(null, 42, expectedSha)).toBe(false);
  });

  it('repairs D1 during registration when the same version is already durable in R2', async () => {
    const subjectId = '18181818-1818-4818-8818-181818181818';
    const resourceId = '19191919-1919-4919-8919-191919191919';
    const versionId = '20202020-2020-4020-8020-202020202020';
    const sha256 = 'ab'.repeat(32);
    const checksum = Uint8Array.from({ length: 32 }, () => 0xab).buffer;
    let headCalls = 0;
    let storedUpdates = 0;

    const env = {
      FILES: {
        head: async () => {
          headCalls += 1;
          return { size: 42, checksums: { sha256: checksum } };
        },
      },
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => {
            if (sql.includes('SELECT id FROM subjects')) {
              return { first: async () => ({ id: subjectId }) };
            }
            if (sql.includes('WHERE id = ?') && sql.includes('COALESCE(size_bytes, size) AS size')) {
              return {
                first: async () => ({
                  resource_id: resourceId,
                  sha256,
                  size: 42,
                }),
              };
            }
            if (sql.includes('SELECT id, resource_id, extraction_status')) {
              return {
                first: async () => ({
                  id: versionId,
                  resource_id: resourceId,
                  extraction_status: 'pending',
                }),
              };
            }
            if (sql.includes('UPDATE resource_versions SET status = ?')) {
              return {
                run: async () => {
                  storedUpdates += 1;
                  return { meta: { changes: 1 } };
                },
              };
            }
            return { sql, args };
          },
        }),
        batch: async () => [],
      },
    };

    const request = new Request('https://example.test/api/resources/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource: {
          id: resourceId,
          subjectId,
          title: 'Objet R2 déjà durable',
          kind: 'text',
          currentVersionId: versionId,
          createdAt: '2026-09-24T00:00:00.000Z',
          updatedAt: '2026-09-24T00:00:00.000Z',
        },
        version: {
          id: versionId,
          resourceId,
          sha256,
          fileName: 'durable.txt',
          mimeType: 'text/plain',
          size: 42,
          createdAt: '2026-09-24T00:00:00.000Z',
        },
      }),
    });

    const response = await registerResource(request, env as never);
    const payload = await response.json() as {
      ok: boolean;
      uploadMode: string;
      alreadyStored: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, uploadMode: 'single', alreadyStored: true });
    expect(headCalls).toBe(1);
    expect(storedUpdates).toBe(1);
  });


  it('requires storage repair when a finalized duplicate has lost its R2 object', async () => {
    const subjectId = '21212121-1111-4111-8111-111111111111';
    const localResourceId = '22222222-1111-4111-8111-111111111111';
    const localVersionId = '23232323-1111-4111-8111-111111111111';
    const remoteResourceId = '24242424-1111-4111-8111-111111111111';
    const remoteVersionId = '25252525-1111-4111-8111-111111111111';
    const sha256 = 'cd'.repeat(32);
    let batchCalls = 0;
    let headCalls = 0;

    const env = {
      FILES: {
        head: async () => {
          headCalls += 1;
          return null;
        },
      },
      DB: {
        prepare: (sql: string) => ({
          bind: () => {
            if (sql.includes('SELECT id FROM subjects')) {
              return { first: async () => ({ id: subjectId }) };
            }
            if (sql.includes('WHERE id = ?') && sql.includes('COALESCE(size_bytes, size) AS size')) {
              return { first: async () => null };
            }
            if (sql.includes('FROM resource_versions') && sql.includes('WHERE sha256 = ?')) {
              return {
                first: async () => ({
                  id: remoteVersionId,
                  resource_id: remoteResourceId,
                  extraction_status: 'ready',
                  status: 'ready',
                  upload_mode: 'single',
                  r2_key: `resources/${remoteResourceId}/${remoteVersionId}`,
                  size: 42,
                  sha256,
                }),
              };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
        batch: async () => {
          batchCalls += 1;
          return [];
        },
      },
    };

    const request = new Request('https://example.test/api/resources/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource: {
          id: localResourceId,
          subjectId,
          title: 'Doublon à réparer',
          kind: 'text',
          currentVersionId: localVersionId,
          createdAt: '2026-09-25T00:00:00.000Z',
          updatedAt: '2026-09-25T00:00:00.000Z',
        },
        version: {
          id: localVersionId,
          resourceId: localResourceId,
          sha256,
          fileName: 'repair.txt',
          mimeType: 'text/plain',
          size: 42,
          createdAt: '2026-09-25T00:00:00.000Z',
        },
      }),
    });

    const response = await registerResource(request, env as never);
    const payload = await response.json() as {
      error: {
        code: string;
        retryable: boolean;
        details?: { existingResourceId?: string };
      };
    };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('DUPLICATE_SUPPORT_STORAGE_MISSING');
    expect(payload.error.retryable).toBe(true);
    expect(payload.error.details?.existingResourceId).toBe(remoteResourceId);
    expect(headCalls).toBe(1);
    expect(batchCalls).toBe(0);
  });


  it('rejects a reused version id when its persisted file identity differs', async () => {
    const subjectId = '26262626-2626-4626-8626-262626262626';
    const resourceId = '27272727-2727-4727-8727-272727272727';
    const versionId = '28282828-2828-4828-8828-282828282828';
    const incomingSha = 'ef'.repeat(32);
    let duplicateLookupCalls = 0;
    let batchCalls = 0;
    let r2Calls = 0;

    const env = {
      FILES: {
        head: async () => {
          r2Calls += 1;
          return null;
        },
      },
      DB: {
        prepare: (sql: string) => ({
          bind: () => {
            if (sql.includes('SELECT id FROM subjects')) {
              return { first: async () => ({ id: subjectId }) };
            }
            if (sql.includes('WHERE id = ?') && sql.includes('COALESCE(size_bytes, size) AS size')) {
              return {
                first: async () => ({
                  resource_id: resourceId,
                  sha256: 'ab'.repeat(32),
                  size: 42,
                }),
              };
            }
            if (sql.includes('WHERE sha256 = ?')) {
              duplicateLookupCalls += 1;
              return { first: async () => null };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
        batch: async () => {
          batchCalls += 1;
          return [];
        },
      },
    };

    const request = new Request('https://example.test/api/resources/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource: {
          id: resourceId,
          subjectId,
          title: 'Identité de version incohérente',
          kind: 'text',
          currentVersionId: versionId,
          createdAt: '2026-09-27T00:00:00.000Z',
          updatedAt: '2026-09-27T00:00:00.000Z',
        },
        version: {
          id: versionId,
          resourceId,
          sha256: incomingSha,
          fileName: 'changed.txt',
          mimeType: 'text/plain',
          size: 42,
          createdAt: '2026-09-27T00:00:00.000Z',
        },
      }),
    });

    const response = await registerResource(request, env as never);
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('VERSION_IDENTITY_CONFLICT');
    expect(payload.error.retryable).toBe(false);
    expect(duplicateLookupCalls).toBe(0);
    expect(batchCalls).toBe(0);
    expect(r2Calls).toBe(0);
  });

});

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

});

import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';

const VERSION_ID = '92929292-9292-4929-8929-929292929292';

function versionDb(overrides: Partial<{
  size: number;
  sha256: string;
  upload_mode: 'single' | 'multipart';
}> = {}) {
  let batchCalls = 0;
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (!sql.includes('FROM resource_versions WHERE id = ?')) {
            throw new Error(`Unexpected SQL: ${sql}`);
          }
          return {
            id: VERSION_ID,
            r2_key: `resources/resource-2/${VERSION_ID}`,
            mime_type: 'text/plain',
            size: overrides.size ?? 4,
            sha256: overrides.sha256 ?? 'ab'.repeat(32),
            extraction_status: 'pending',
            upload_mode: overrides.upload_mode ?? 'single',
            multipart_upload_id: null,
            multipart_part_size: null,
            multipart_parts_json: null,
          };
        },
      }),
    }),
    batch: async () => {
      batchCalls += 1;
      return [];
    },
  };
  return { db, batchCalls: () => batchCalls };
}

describe('client extraction state R2 integrity', () => {
  it('rejects a ready extraction when the R2 checksum no longer matches D1', async () => {
    const state = versionDb();

    const env = {
      DB: state.db,
      FILES: {
        head: async () => ({
          size: 4,
          checksums: {
            sha256: Uint8Array.from({ length: 32 }, () => 0xcd).buffer,
          },
          customMetadata: {},
        }),
      },
    };

    const response = await worker.fetch(
      new Request(`https://example.test/api/resource-versions/${VERSION_ID}/extraction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ready',
          pages: [{ pageNumber: 1, text: 'abcd' }],
          charCount: 4,
        }),
      }),
      env as never,
    );
    const payload = await response.json() as {
      error: { code: string; retryable: boolean };
    };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('FILE_INTEGRITY_ERROR');
    expect(payload.error.retryable).toBe(false);
    expect(state.batchCalls()).toBe(0);
  });

  it('rejects an extraction failure write when the R2 object is missing', async () => {
    const state = versionDb();

    const env = {
      DB: state.db,
      FILES: {
        head: async () => null,
      },
    };

    const response = await worker.fetch(
      new Request(`https://example.test/api/resource-versions/${VERSION_ID}/extraction-failure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'LOCAL_EXTRACTION_FAILED',
          message: 'Extraction locale impossible.',
        }),
      }),
      env as never,
    );
    const payload = await response.json() as {
      error: { code: string; retryable: boolean };
    };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('FILE_NOT_STORED');
    expect(payload.error.retryable).toBe(true);
    expect(state.batchCalls()).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';

const VERSION_ID = '91919191-9191-4919-8919-919191919191';

describe('server extraction R2 integrity', () => {
  it('refuses to persist extraction when the stored object checksum no longer matches D1', async () => {
    const expectedSha = 'ab'.repeat(32);
    let textReads = 0;
    let batchCalls = 0;

    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (!sql.includes('FROM resource_versions v')) {
                throw new Error(`Unexpected SQL: ${sql}`);
              }
              return {
                r2_key: `resources/resource-1/${VERSION_ID}`,
                mime_type: 'text/plain',
                file_name: 'integrity.txt',
                size: 4,
                sha256: expectedSha,
                upload_mode: 'single',
                kind: 'text',
              };
            },
          }),
        }),
        batch: async () => {
          batchCalls += 1;
          return [];
        },
      },
      FILES: {
        get: async () => ({
          size: 4,
          checksums: {
            sha256: Uint8Array.from({ length: 32 }, () => 0xcd).buffer,
          },
          customMetadata: {},
          text: async () => {
            textReads += 1;
            return 'wrong content';
          },
        }),
      },
    };

    const response = await worker.fetch(
      new Request(`https://example.test/api/resource-versions/${VERSION_ID}/server-extraction`, {
        method: 'POST',
      }),
      env as never,
    );
    const payload = await response.json() as {
      error: { code: string; retryable: boolean };
    };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('FILE_INTEGRITY_ERROR');
    expect(payload.error.retryable).toBe(false);
    expect(textReads).toBe(0);
    expect(batchCalls).toBe(0);
  });
});

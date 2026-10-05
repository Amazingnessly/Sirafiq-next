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
  it('persists a failed extraction when PDF conversion returns only a synthetic page index', async () => {
    const expectedSha = 'ab'.repeat(32);
    const syntheticText = ['Contents', ...Array.from({ length: 32 }, (_, index) => `Page ${index + 1}`)].join('\n');
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
                mime_type: 'application/pdf',
                file_name: 'synthetic-index.pdf',
                size: 4,
                sha256: expectedSha,
                upload_mode: 'single',
                kind: 'pdf',
              };
            },
          }),
        }),
        batch: async () => {
          batchCalls += 1;
          return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
        },
      },
      FILES: {
        get: async () => ({
          size: 4,
          checksums: {
            sha256: Uint8Array.from({ length: 32 }, (_, index) => index % 2 === 0 ? 0xab : 0xab).buffer,
          },
          customMetadata: {},
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        }),
      },
      AI: {
        toMarkdown: async () => ({
          format: 'text',
          data: syntheticText,
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
      status: string;
      code?: string;
      message?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe('failed');
    expect(payload.code).toBe('EMPTY_SERVER_EXTRACTION');
    expect(payload.message).toMatch(/texte source exploitable/);
    expect(batchCalls).toBe(1);
  });

});

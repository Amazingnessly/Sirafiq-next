import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';

const VERSION_ID = '81818181-8181-4818-8818-818181818181';

describe('client extraction quality boundary', () => {
  it('rejects page-index-only PDF extraction before persisting ready state', async () => {
    const expectedSha = 'ab'.repeat(32);
    const syntheticText = ['Contents', ...Array.from({ length: 30 }, (_, index) => `Page ${index + 1}`)].join('\n');
    let batchCalls = 0;

    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (sql.includes('FROM resource_versions WHERE id')) {
                return {
                  id: VERSION_ID,
                  r2_key: `resources/resource-1/${VERSION_ID}`,
                  mime_type: 'application/pdf',
                  size: 4,
                  sha256: expectedSha,
                  extraction_status: 'pending',
                  upload_mode: 'single',
                  multipart_upload_id: null,
                  multipart_part_size: null,
                  multipart_parts_json: null,
                };
              }
              if (sql.includes('JOIN resources r ON r.id = v.resource_id')) {
                return { kind: 'pdf' };
              }
              throw new Error(`Unexpected SQL: ${sql}`);
            },
          }),
        }),
        batch: async () => {
          batchCalls += 1;
          return [];
        },
      },
      FILES: {
        head: async () => ({
          size: 4,
          checksums: {
            sha256: Uint8Array.from({ length: 32 }, () => 0xab).buffer,
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
          pages: [{ pageNumber: 1, text: syntheticText }],
          charCount: syntheticText.length,
        }),
      }),
      env as never,
    );
    const payload = await response.json() as {
      error: { code: string; retryable: boolean; message: string };
    };

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe('PDF_EXTRACTION_NOT_USEFUL');
    expect(payload.error.retryable).toBe(false);
    expect(payload.error.message).toMatch(/contenu source exploitable/);
    expect(batchCalls).toBe(0);
  });
});

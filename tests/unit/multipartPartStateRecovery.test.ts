import { describe, expect, it, vi } from 'vitest';
import { uploadMultipartPart } from '../../worker/index';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';

function makeRequest(partNumber = 1) {
  return new Request(
    `https://example.test/api/resource-versions/${VERSION_ID}/multipart/part?uploadId=upload-1&partNumber=${partNumber}`,
    {
      method: 'PUT',
      body: new Blob([new Uint8Array(8)]),
      headers: {
        'Content-Type': 'application/pdf',
        'X-Sirafiq-Part-Size': '8',
      },
    },
  );
}

function versionRow() {
  return {
    id: VERSION_ID,
    r2_key: `resources/resource-1/${VERSION_ID}`,
    mime_type: 'application/pdf',
    size: 16,
    sha256: 'a'.repeat(64),
    extraction_status: 'pending' as const,
    multipart_upload_id: 'upload-1',
    multipart_part_size: 8,
    multipart_parts_json: '[]',
  };
}

describe('multipart part state recovery', () => {
  it('does not classify a D1 persistence failure as an invalid R2 session', async () => {
    const uploadPart = vi.fn(async () => ({ partNumber: 1, etag: 'etag-1' }));
    const env = {
      FILES: {
        resumeMultipartUpload: () => ({ uploadPart }),
      },
      DB: {
        prepare: (sql: string) => ({
          bind: () => sql.includes('SELECT id, r2_key')
            ? { first: async () => versionRow() }
            : { run: async () => { throw new Error('D1 temporarily unavailable'); } },
        }),
      },
    };

    const response = await uploadMultipartPart(VERSION_ID, makeRequest(), env as never);
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(uploadPart).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
    expect(payload.error.code).toBe('MULTIPART_PART_STATE_FAILED');
    expect(payload.error.retryable).toBe(true);
  });

  it('keeps actual R2 upload failures on the session-invalid recovery path', async () => {
    const uploadPart = vi.fn(async () => { throw new Error('NoSuchUpload'); });
    const env = {
      FILES: {
        resumeMultipartUpload: () => ({ uploadPart }),
      },
      DB: {
        prepare: () => ({
          bind: () => ({ first: async () => versionRow() }),
        }),
      },
    };

    const response = await uploadMultipartPart(VERSION_ID, makeRequest(), env as never);
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('MULTIPART_SESSION_INVALID');
    expect(payload.error.retryable).toBe(true);
  });
});

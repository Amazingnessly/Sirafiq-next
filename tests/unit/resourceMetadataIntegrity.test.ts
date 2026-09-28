import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';

const SUBJECT_ID = '51515151-1111-4111-8111-111111111111';
const RESOURCE_ID = '52525252-1111-4111-8111-111111111111';
const VERSION_ID = '53535353-1111-4111-8111-111111111111';
const OTHER_RESOURCE_ID = '54545454-1111-4111-8111-111111111111';
const NOW = '2026-09-28T00:00:00.000Z';

function subjectRows() {
  return [{ id: SUBJECT_ID, name: 'Matière distante', parent_id: null, created_at: NOW, updated_at: NOW }];
}

function baseResourceRow() {
  return {
    id: RESOURCE_ID,
    subject_id: SUBJECT_ID,
    title: 'Support distant',
    kind: 'text' as const,
    current_version_id: VERSION_ID,
    created_at: NOW,
    updated_at: NOW,
  };
}

function readyDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...baseResourceRow(),
    subject_row_id: SUBJECT_ID,
    subject_name: 'Matière distante',
    subject_parent_id: null,
    subject_created_at: NOW,
    subject_updated_at: NOW,
    version_id: VERSION_ID,
    version_resource_id: RESOURCE_ID,
    file_name: 'support.txt',
    mime_type: 'text/plain',
    size: 4,
    sha256: 'ab'.repeat(32),
    status: 'ready',
    extraction_status: 'ready',
    extraction_error: null,
    content_json: JSON.stringify([{ pageNumber: 1, text: 'abcd' }]),
    char_count: 4,
    ...overrides,
  };
}

describe('remote resource metadata integrity', () => {
  it('does not turn a missing current version into an empty bootstrap', async () => {
    const env = {
      DB: {
        prepare: (sql: string) => ({
          all: async () => {
            if (sql.includes('FROM subjects')) return { results: subjectRows() };
            if (sql.includes('FROM resources')) {
              if (!sql.includes('LEFT JOIN resource_versions')) return { results: [] };
              return { results: [{
                ...baseResourceRow(),
                version_id: null,
                version_resource_id: null,
                status: null,
                char_count: null,
              }] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
      },
    };

    const response = await worker.fetch(new Request('https://example.test/api/bootstrap'), env as never);
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('RESOURCE_VERSION_MISSING');
    expect(payload.error.retryable).toBe(false);
  });

  it('rejects a bootstrap version that belongs to another resource', async () => {
    const env = {
      DB: {
        prepare: (sql: string) => ({
          all: async () => {
            if (sql.includes('FROM subjects')) return { results: subjectRows() };
            if (sql.includes('FROM resources')) return { results: [{
              ...baseResourceRow(),
              version_id: VERSION_ID,
              version_resource_id: OTHER_RESOURCE_ID,
              status: 'ready',
              char_count: 12,
            }] };
            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
      },
    };

    const response = await worker.fetch(new Request('https://example.test/api/bootstrap'), env as never);
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('RESOURCE_VERSION_IDENTITY_CONFLICT');
    expect(payload.error.retryable).toBe(false);
  });

  it('distinguishes a surviving resource with a missing version from a 404 detail', async () => {
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (!sql.includes('LEFT JOIN subjects') || !sql.includes('LEFT JOIN resource_versions')) return null;
              return {
                ...baseResourceRow(),
                subject_row_id: SUBJECT_ID,
                subject_name: 'Matière distante',
                subject_parent_id: null,
                subject_created_at: NOW,
                subject_updated_at: NOW,
                version_id: null,
                version_resource_id: null,
                file_name: null,
                mime_type: null,
                size: null,
                sha256: null,
                status: null,
                extraction_status: null,
                extraction_error: null,
                content_json: null,
                char_count: null,
              };
            },
          }),
        }),
      },
    };

    const response = await worker.fetch(new Request(`https://example.test/api/resources/${RESOURCE_ID}`), env as never);
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('RESOURCE_VERSION_MISSING');
    expect(payload.error.retryable).toBe(false);
  });
  it('does not expose inconsistent or missing ready extraction metadata in bootstrap', async () => {
    const corruptedRows = [
      {
        ...baseResourceRow(),
        version_id: VERSION_ID,
        version_resource_id: RESOURCE_ID,
        status: 'ready',
        extraction_status: 'pending',
        extraction_version_id: null,
        char_count: null,
      },
      {
        ...baseResourceRow(),
        version_id: VERSION_ID,
        version_resource_id: RESOURCE_ID,
        status: 'ready',
        extraction_status: 'ready',
        extraction_version_id: null,
        char_count: null,
      },
    ];

    for (const corrupted of corruptedRows) {
      const env = {
        DB: {
          prepare: (sql: string) => ({
            all: async () => {
              if (sql.includes('FROM subjects')) return { results: subjectRows() };
              if (sql.includes('FROM resources')) return { results: [corrupted] };
              throw new Error(`Unexpected SQL: ${sql}`);
            },
          }),
        },
      };

      const response = await worker.fetch(new Request('https://example.test/api/bootstrap'), env as never);
      const payload = await response.json() as { error: { code: string; retryable: boolean } };

      expect(response.status).toBe(409);
      expect(payload.error.code).toBe('RESOURCE_EXTRACTION_INTEGRITY_ERROR');
      expect(payload.error.retryable).toBe(false);
    }
  });

  it('rejects missing, malformed or char-count-mismatched ready extraction detail', async () => {
    const corruptedRows = [
      readyDetailRow({ content_json: null, char_count: null }),
      readyDetailRow({ content_json: 'not-json', char_count: 8 }),
      readyDetailRow({
        content_json: JSON.stringify([{ pageNumber: 1, text: 'abcd' }]),
        char_count: 3,
      }),
    ];

    for (const corrupted of corruptedRows) {
      const env = {
        DB: {
          prepare: (sql: string) => ({
            bind: () => ({
              first: async () => {
                if (!sql.includes('LEFT JOIN subjects') || !sql.includes('LEFT JOIN resource_versions')) {
                  throw new Error(`Unexpected SQL: ${sql}`);
                }
                return corrupted;
              },
            }),
          }),
        },
      };

      const response = await worker.fetch(
        new Request(`https://example.test/api/resources/${RESOURCE_ID}`),
        env as never,
      );
      const payload = await response.json() as { error: { code: string; retryable: boolean } };

      expect(response.status).toBe(409);
      expect(payload.error.code).toBe('RESOURCE_EXTRACTION_INTEGRITY_ERROR');
      expect(payload.error.retryable).toBe(false);
    }
  });

  it('returns a ready extraction only when persisted metadata is internally consistent', async () => {
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (!sql.includes('LEFT JOIN subjects') || !sql.includes('LEFT JOIN resource_versions')) {
                throw new Error(`Unexpected SQL: ${sql}`);
              }
              return readyDetailRow();
            },
          }),
        }),
      },
    };

    const response = await worker.fetch(
      new Request(`https://example.test/api/resources/${RESOURCE_ID}`),
      env as never,
    );
    const payload = await response.json() as {
      extraction: { pages: Array<{ pageNumber: number; text: string }>; charCount: number } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.extraction).toEqual({
      pages: [{ pageNumber: 1, text: 'abcd' }],
      charCount: 4,
    });
  });

});

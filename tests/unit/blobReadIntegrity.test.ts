import { describe, expect, it } from 'vitest';
import { getBlob, matchesStoredResourceObject } from '../../worker/index';

const VERSION_ID = '71717171-7171-4717-8717-717171717171';

function stream(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
}

function singleChecksum(hexByte: number) {
  return Uint8Array.from({ length: 32 }, () => hexByte).buffer;
}

function dbFor(version: {
  r2_key: string;
  mime_type: string;
  file_name: string;
  total_size: number;
  sha256: string;
  upload_mode: 'single' | 'multipart';
}) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => version,
      }),
    }),
  };
}

function r2Object(input: {
  size: number;
  etag?: string;
  checksum?: ArrayBuffer;
  customMetadata?: Record<string, string>;
  body?: number[];
  range?: { offset: number; length: number };
}) {
  const etag = input.etag ?? 'etag-1';
  return {
    size: input.size,
    etag,
    httpEtag: `"${etag}"`,
    checksums: input.checksum ? { sha256: input.checksum } : {},
    customMetadata: input.customMetadata ?? {},
    body: stream(input.body ?? [1, 2, 3, 4]),
    range: input.range,
    writeHttpMetadata: (headers: Headers) => headers.set('Content-Type', 'application/pdf'),
  };
}

describe('R2 read integrity', () => {
  it('matches single and multipart objects using their durable identity metadata', () => {
    const singleSha = 'ab'.repeat(32);
    expect(matchesStoredResourceObject({
      size: 4,
      checksums: { sha256: singleChecksum(0xab) },
    }, 'single', 4, singleSha)).toBe(true);
    expect(matchesStoredResourceObject({
      size: 4,
      customMetadata: { sha256: 'c'.repeat(64) },
    }, 'multipart', 4, 'c'.repeat(64))).toBe(true);
    expect(matchesStoredResourceObject({
      size: 4,
      customMetadata: { sha256: 'd'.repeat(64) },
    }, 'multipart', 4, 'c'.repeat(64))).toBe(false);
  });

  it('refuses a full read when the R2 checksum no longer matches D1', async () => {
    const expectedSha = 'ab'.repeat(32);
    const env = {
      DB: dbFor({
        r2_key: `resources/resource-1/${VERSION_ID}`,
        mime_type: 'application/pdf',
        file_name: 'integrity.pdf',
        total_size: 4,
        sha256: expectedSha,
        upload_mode: 'single',
      }),
      FILES: {
        get: async () => r2Object({
          size: 4,
          checksum: singleChecksum(0xcd),
        }),
      },
    };

    const response = await getBlob(
      VERSION_ID,
      new Request(`https://example.test/api/resource-versions/${VERSION_ID}/blob`),
      env as never,
    );
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('FILE_INTEGRITY_ERROR');
    expect(payload.error.retryable).toBe(false);
  });

  it('refuses a ranged read before fetching bytes when multipart metadata is wrong', async () => {
    const expectedSha = 'c'.repeat(64);
    let getCalls = 0;
    const env = {
      DB: dbFor({
        r2_key: `resources/resource-2/${VERSION_ID}`,
        mime_type: 'application/pdf',
        file_name: 'range.pdf',
        total_size: 16,
        sha256: expectedSha,
        upload_mode: 'multipart',
      }),
      FILES: {
        head: async () => r2Object({
          size: 16,
          customMetadata: { sha256: 'd'.repeat(64) },
        }),
        get: async () => {
          getCalls += 1;
          return null;
        },
      },
    };

    const response = await getBlob(
      VERSION_ID,
      new Request(`https://example.test/api/resource-versions/${VERSION_ID}/blob`, {
        headers: { Range: 'bytes=0-3' },
      }),
      env as never,
    );
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('FILE_INTEGRITY_ERROR');
    expect(getCalls).toBe(0);
  });

  it('rejects a range when the object changes between HEAD and GET', async () => {
    const expectedSha = 'c'.repeat(64);
    const env = {
      DB: dbFor({
        r2_key: `resources/resource-3/${VERSION_ID}`,
        mime_type: 'application/pdf',
        file_name: 'race.pdf',
        total_size: 16,
        sha256: expectedSha,
        upload_mode: 'multipart',
      }),
      FILES: {
        head: async () => r2Object({
          size: 16,
          etag: 'before',
          customMetadata: { sha256: expectedSha },
        }),
        get: async () => r2Object({
          size: 4,
          etag: 'after',
          customMetadata: { sha256: expectedSha },
          body: [1, 2, 3, 4],
          range: { offset: 0, length: 4 },
        }),
      },
    };

    const response = await getBlob(
      VERSION_ID,
      new Request(`https://example.test/api/resource-versions/${VERSION_ID}/blob`, {
        headers: { Range: 'bytes=0-3' },
      }),
      env as never,
    );
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('FILE_CHANGED_DURING_READ');
    expect(payload.error.retryable).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import entry from '../../worker/entry';

const ID = '90909090-9090-4090-8090-909090909090';
const KEY = 'resources/test/' + ID;
const SHA = 'ab'.repeat(32);
const BYTES = new TextEncoder().encode('abcdef');

function makeEnv(valid: boolean) {
  let reads = 0;
  let heads = 0;
  const stored = {
    size: BYTES.length,
    etag: 'etag-stable',
    httpEtag: '"etag-stable"',
    checksums: { sha256: Uint8Array.from({ length: 32 }, () => valid ? 0xab : 0xcd).buffer },
    writeHttpMetadata: (headers: Headers) => headers.set('Content-Type', 'application/pdf'),
  };
  const env = {
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => ({
        r2_key: KEY,
        mime_type: 'application/pdf',
        file_name: 'test.pdf',
        total_size: BYTES.length,
        sha256: SHA,
        upload_mode: 'single',
      }) }) }),
    },
    FILES: {
      head: async () => { heads++; return stored; },
      get: async (_key: string, options?: { range?: { offset: number; length: number } }) => {
        reads++;
        const range = options?.range;
        const data = range ? BYTES.slice(range.offset, range.offset + range.length) : BYTES;
        return {
          ...stored,
          range: range ? { offset: range.offset, length: range.length } : undefined,
          body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } }),
        };
      },
    },
  };
  return { env, counters: () => ({ reads, heads }) };
}

describe('real Worker entrypoint and R2 blob integrity', () => {
  it('rejects mismatched R2 checksum before any ranged body read', async () => {
    const { env, counters } = makeEnv(false);
    const response = await entry.fetch(new Request('http://example.test/api/resource-versions/' + ID + '/blob', {
      headers: { Range: 'bytes=1-3' },
    }), env as never);
    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('FILE_INTEGRITY_ERROR');
    expect(counters()).toEqual({ reads: 0, heads: 1 });
  });

  it('rejects a mismatched checksum for complete reads', async () => {
    const { env } = makeEnv(false);
    const response = await entry.fetch(new Request('http://example.test/api/resource-versions/' + ID + '/blob'), env as never);
    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('FILE_INTEGRITY_ERROR');
  });

  it('continues to serve a valid 206 byte-range response', async () => {
    const { env, counters } = makeEnv(true);
    const response = await entry.fetch(new Request('http://example.test/api/resource-versions/' + ID + '/blob', {
      headers: { Range: 'bytes=1-3' },
    }), env as never);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 1-3/6');
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('bcd');
    expect(counters()).toEqual({ reads: 1, heads: 1 });
  });

  it('continues to serve valid complete bodies', async () => {
    const { env } = makeEnv(true);
    const response = await entry.fetch(new Request('http://example.test/api/resource-versions/' + ID + '/blob'), env as never);
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('abcdef');
  });
});

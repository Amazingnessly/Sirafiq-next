import { describe, expect, it } from 'vitest';
import { createBlobResponse, parseByteRange } from '../../worker/index';

function stream(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
}

describe('Worker blob range responses', () => {
  it('keeps a request without Range as a complete 200 response while advertising byte ranges', async () => {
    const headers = new Headers({ 'Content-Type': 'application/pdf' });
    const response = createBlobResponse(stream([1, 2, 3, 4]), headers, 4, null);

    expect(response.status).toBe(200);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(response.headers.get('Content-Range')).toBeNull();
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });

  it('builds a truthful 206 response for the actual returned byte range', async () => {
    const response = createBlobResponse(
      stream([4, 5, 6]),
      new Headers({ 'Content-Type': 'application/pdf' }),
      10,
      { offset: 4, length: 3, totalSize: 10 },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Length')).toBe('3');
    expect(response.headers.get('Content-Range')).toBe('bytes 4-6/10');
  });

  it('parses bounded, open-ended and suffix ranges and rejects unsatisfiable input', () => {
    expect(parseByteRange('bytes=4-9', 16)).toEqual({ offset: 4, length: 6 });
    expect(parseByteRange('bytes=10-', 16)).toEqual({ offset: 10, length: 6 });
    expect(parseByteRange('bytes=-4', 16)).toEqual({ offset: 12, length: 4 });
    expect(parseByteRange('bytes=99-100', 16)).toBe('invalid');
    expect(parseByteRange('bytes=4-3', 16)).toBe('invalid');
    expect(parseByteRange('bytes=1-2,4-5', 16)).toBe('invalid');
  });
});

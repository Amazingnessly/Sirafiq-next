import { describe, expect, it } from 'vitest';
import { matchesCompletedMultipartObject } from '../../worker/index';

describe('multipart completion recovery', () => {
  it('accepts only the exact finalized R2 object expected by D1', () => {
    const sha256 = 'a'.repeat(64);

    expect(matchesCompletedMultipartObject({
      size: 42,
      customMetadata: { sha256 },
    }, 42, sha256)).toBe(true);

    expect(matchesCompletedMultipartObject({
      size: 41,
      customMetadata: { sha256 },
    }, 42, sha256)).toBe(false);

    expect(matchesCompletedMultipartObject({
      size: 42,
      customMetadata: { sha256: 'b'.repeat(64) },
    }, 42, sha256)).toBe(false);

    expect(matchesCompletedMultipartObject({
      size: 42,
      customMetadata: {},
    }, 42, sha256)).toBe(false);

    expect(matchesCompletedMultipartObject(null, 42, sha256)).toBe(false);
  });
});

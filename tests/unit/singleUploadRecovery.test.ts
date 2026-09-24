import { describe, expect, it } from 'vitest';
import { matchesStoredSingleObject } from '../../worker/index';

describe('single upload R2 recovery', () => {
  it('accepts only the exact R2 object identified by size and SHA-256', () => {
    const expectedSha = 'ab'.repeat(32);
    const checksum = Uint8Array.from({ length: 32 }, () => 0xab).buffer;

    expect(matchesStoredSingleObject({
      size: 42,
      checksums: { sha256: checksum },
    }, 42, expectedSha)).toBe(true);

    expect(matchesStoredSingleObject({
      size: 41,
      checksums: { sha256: checksum },
    }, 42, expectedSha)).toBe(false);

    expect(matchesStoredSingleObject({
      size: 42,
      checksums: { sha256: Uint8Array.from({ length: 32 }, () => 0xcd).buffer },
    }, 42, expectedSha)).toBe(false);

    expect(matchesStoredSingleObject({ size: 42, checksums: {} }, 42, expectedSha)).toBe(false);
    expect(matchesStoredSingleObject(null, 42, expectedSha)).toBe(false);
  });
});

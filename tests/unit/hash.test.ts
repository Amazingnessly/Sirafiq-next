import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/lib/hash';
import { IncrementalSha256 } from '../../src/lib/incrementalSha256';

describe('sha256Hex', () => {
  it('correspond aux vecteurs SHA-256 connus', async () => {
    expect(await sha256Hex(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(new Blob(['Sirafiq']))).toBe('6f6f788f7f71f65372a883fc464410b972c0be64ecd3ac1f9607044f4547a58a');
  });

  it('reste exact quand les données traversent de nombreuses limites de blocs', () => {
    const bytes = new TextEncoder().encode('0123456789abcdef'.repeat(100_000));
    const hash = new IncrementalSha256();
    for (let offset = 0; offset < bytes.length; offset += 7777) {
      hash.update(bytes.subarray(offset, Math.min(offset + 7777, bytes.length)));
    }
    expect(hash.digestHex()).toBe('39ec05ee6a2d25b6c775d195d1ce3e75aa64dd11c76506827bc414d90b6a6184');
  });
});

import { describe, expect, it } from 'vitest';
import { sha256ArrayBuffer, sha256Hex } from '../../src/lib/hash';
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

  it('reste identique à WebCrypto autour des frontières de blocs et de padding', async () => {
    for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 4097]) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + 17) & 0xff;

      const expected = await sha256ArrayBuffer(bytes.buffer.slice(0));
      const hash = new IncrementalSha256();
      let offset = 0;
      let step = 1;
      while (offset < bytes.length) {
        const end = Math.min(offset + step, bytes.length);
        hash.update(bytes.subarray(offset, end));
        offset = end;
        step = step === 73 ? 1 : step + 7;
      }
      expect(hash.digestHex(), `taille ${length}`).toBe(expected);
    }
  });
});

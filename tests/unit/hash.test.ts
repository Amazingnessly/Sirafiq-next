import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/lib/hash';

describe('sha256Hex', () => {
  it('produit une empreinte SHA-256 stable', async () => {
    const value = await sha256Hex(new Blob(['Sirafiq']));
    expect(value).toMatch(/^[a-f0-9]{64}$/);
    expect(await sha256Hex(new Blob(['Sirafiq']))).toBe(value);
    expect(await sha256Hex(new Blob(['Sirāfiq']))).not.toBe(value);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type WranglerConfig = {
  ai?: { binding?: string };
  env?: {
    preview?: {
      ai?: { binding?: string };
    };
  };
};

describe('Cloudflare deployment bindings', () => {
  it('keeps server extraction AI available in production and preview', () => {
    const config = JSON.parse(
      readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'),
    ) as WranglerConfig;

    expect(config.ai?.binding).toBe('AI');
    expect(config.env?.preview?.ai?.binding).toBe('AI');
  });
});

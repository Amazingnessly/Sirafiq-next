import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type WranglerConfig = {
  ai?: { binding?: string };
  r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
  env?: {
    preview?: {
      ai?: { binding?: string };
      r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
    };
  };
};

function readConfig(): WranglerConfig {
  return JSON.parse(
    readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'),
  ) as WranglerConfig;
}

describe('Cloudflare deployment bindings', () => {
  it('keeps server extraction AI available in production and preview', () => {
    const config = readConfig();

    expect(config.ai?.binding).toBe('AI');
    expect(config.env?.preview?.ai?.binding).toBe('AI');
  });

  it('keeps preview R2 isolated from production storage', () => {
    const config = readConfig();
    const productionFiles = config.r2_buckets?.find((binding) => binding.binding === 'FILES');
    const previewFiles = config.env?.preview?.r2_buckets?.find((binding) => binding.binding === 'FILES');

    expect(productionFiles?.bucket_name).toBe('sirafiq-next-files');
    expect(previewFiles?.bucket_name).toBe('sirafiq-next-preview-files');
    expect(previewFiles?.bucket_name).not.toBe(productionFiles?.bucket_name);
  });
});

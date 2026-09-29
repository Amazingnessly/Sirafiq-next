import { expect, test } from '@playwright/test';

test('le Worker et l’interface exposent la même identité de build', async ({ page, request }) => {
  const response = await request.get('/api/build', {
    headers: { 'cache-control': 'no-cache' },
  });
  expect(response.ok()).toBe(true);
  expect(response.headers()['cache-control']).toContain('no-store');

  const build = await response.json() as {
    version: string;
    sha: string;
    shortSha: string;
    branch: string;
    isLocal: boolean;
  };

  expect(build.version).toBe('0.1.0');
  expect(build.sha.length).toBeGreaterThan(0);
  expect(build.shortSha).toBe(build.sha === 'local' ? 'local' : build.sha.slice(0, 8));
  expect(build.branch.length).toBeGreaterThan(0);

  await page.goto('/bibliotheque');
  const shell = page.locator('.app-shell');
  await expect(shell).toHaveAttribute('data-build-sha', build.sha);
  await expect(page.getByLabel(`Version ${build.version}, build ${build.shortSha}`)).toBeVisible();
});

import { expect, test } from '@playwright/test';

test('un support local s’ouvre sans requête distante concurrente', async ({ page }) => {
  let resourceRequests = 0;
  await page.route('**/api/resources/**', async (route) => {
    resourceRequests += 1;
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
  });

  await page.goto('/bibliotheque');
  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Local first E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByLabel(/Titre/).fill('Support local prioritaire');
  await page.getByLabel('Contenu').fill('Ce contenu doit être résolu depuis IndexedDB avant tout fallback réseau.');
  await page.getByRole('button', { name: 'Importer le support' }).click();
  await expect(page.getByRole('heading', { name: 'Support local prioritaire' })).toBeVisible();

  await page.getByRole('heading', { name: 'Support local prioritaire' }).click();
  await expect(page.getByText('Ce contenu doit être résolu depuis IndexedDB avant tout fallback réseau.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Ce contenu doit être résolu depuis IndexedDB avant tout fallback réseau.')).toBeVisible();

  expect(resourceRequests).toBe(0);
});

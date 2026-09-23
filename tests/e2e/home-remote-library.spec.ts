import { expect, test } from '@playwright/test';

test('l’accueil retrouve les supports synchronisés quand IndexedDB est vide', async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjects: [{
          id: '11111111-aaaa-4111-8111-111111111111',
          name: 'Matière distante',
          parentId: null,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
        }],
        resources: [{
          id: '22222222-bbbb-4222-8222-222222222222',
          subjectId: '11111111-aaaa-4111-8111-111111111111',
          title: 'Support distant',
          kind: 'text',
          currentVersionId: '33333333-cccc-4333-8333-333333333333',
          status: 'ready',
          extractionCharCount: 42,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
        }],
      }),
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Retrouver mes supports synchronisés' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reprendre mes supports' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Créer ma première matière' })).toHaveCount(0);

  const metrics = page.getByLabel('État de la bibliothèque');
  await expect(metrics.locator('.metric').filter({ hasText: 'matières' }).getByText('1', { exact: true })).toBeVisible();
  await expect(metrics.locator('.metric').filter({ hasText: 'supports' }).getByText('1', { exact: true })).toBeVisible();
  await expect(metrics.locator('.metric').filter({ hasText: 'extraits' }).getByText('1', { exact: true })).toBeVisible();
});

test('une panne du bootstrap ne transforme pas l’accueil en faux état vide', async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE_E2E', message: 'Bootstrap indisponible', retryable: true } }),
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Retrouver ma bibliothèque' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vérifier ma bibliothèque' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Créer ma première matière' })).toHaveCount(0);
  await expect(page.getByText('Sirāfiq ne considère pas cette erreur réseau comme une bibliothèque vide.')).toBeVisible();
});

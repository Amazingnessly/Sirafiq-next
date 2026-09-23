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

test('l’accueil ne présente pas un envoi distant incomplet comme support consultable', async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjects: [{
          id: '44444444-dddd-4444-8444-444444444444',
          name: 'Matière distante',
          parentId: null,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
        }],
        resources: [{
          id: '55555555-eeee-4555-8555-555555555555',
          subjectId: '44444444-dddd-4444-8444-444444444444',
          title: 'PDF encore en cours',
          kind: 'pdf',
          currentVersionId: '66666666-ffff-4666-8666-666666666666',
          status: 'uploading',
          extractionCharCount: null,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:01.000Z',
        }],
      }),
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Retrouver mes envois incomplets' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vérifier mon envoi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Retrouver mes supports synchronisés' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Reprendre mes supports' })).toHaveCount(0);
  await expect(page.getByText(/Il n’est pas encore déclaré consultable/)).toBeVisible();

  const metrics = page.getByLabel('État de la bibliothèque');
  await expect(metrics.locator('.metric').filter({ hasText: 'supports' }).getByText('1', { exact: true })).toBeVisible();
  await expect(metrics.locator('.metric').filter({ hasText: 'extraits' }).getByText('0', { exact: true })).toBeVisible();
});

test('l’accueil ne présente pas un texte distant non extrait comme déjà lisible', async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjects: [{
          id: '77777777-aaaa-4777-8777-777777777777',
          name: 'Textes distants',
          parentId: null,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
        }],
        resources: [{
          id: '88888888-bbbb-4888-8888-888888888888',
          subjectId: '77777777-aaaa-4777-8777-777777777777',
          title: 'Texte stocké sans extraction',
          kind: 'text',
          currentVersionId: '99999999-cccc-4999-8999-999999999999',
          status: 'stored',
          extractionCharCount: null,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:01.000Z',
        }],
      }),
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Retrouver mes textes à récupérer' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vérifier mon texte' })).toBeVisible();
  await expect(page.getByText(/son contenu n’est pas encore déclaré lisible/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reprendre mes supports' })).toHaveCount(0);
  await expect(page.getByText(/Ouvrez la bibliothèque pour les consulter/)).toHaveCount(0);

  const metrics = page.getByLabel('État de la bibliothèque');
  await expect(metrics.locator('.metric').filter({ hasText: 'supports' }).getByText('1', { exact: true })).toBeVisible();
  await expect(metrics.locator('.metric').filter({ hasText: 'extraits' }).getByText('0', { exact: true })).toBeVisible();
});


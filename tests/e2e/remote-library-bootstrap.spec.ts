import { expect, test } from '@playwright/test';

const SUBJECT_ID = 'abababab-abab-4bab-8bab-abababababab';
const RESOURCE_ID = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const VERSION_ID = 'efefefef-efef-4fef-8fef-efefefefefef';

test('une bibliothèque locale vide retrouve les supports synchronisés sans écraser le local-first', async ({ page }) => {
  const remoteText = 'Texte synchronisé retrouvé depuis D1 après perte du stockage local.';

  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjects: [{
          id: SUBJECT_ID,
          name: 'Matière distante E2E',
          parentId: null,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
        }],
        resources: [{
          id: RESOURCE_ID,
          subjectId: SUBJECT_ID,
          title: 'Support distant E2E',
          kind: 'text',
          currentVersionId: VERSION_ID,
          status: 'ready',
          extractionCharCount: remoteText.length,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
        }],
      }),
    });
  });

  await page.route(`**/api/resources/${RESOURCE_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        resource: {
          id: RESOURCE_ID,
          subjectId: SUBJECT_ID,
          title: 'Support distant E2E',
          kind: 'text',
          currentVersionId: VERSION_ID,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
        },
        version: {
          id: VERSION_ID,
          fileName: 'distant.txt',
          mimeType: 'text/plain',
          size: remoteText.length,
          sha256: 'remote-e2e-sha',
          status: 'ready',
          extractionStatus: 'ready',
          extractionError: null,
        },
        extraction: {
          pages: [{ pageNumber: 1, text: remoteText }],
          charCount: remoteText.length,
        },
      }),
    });
  });

  await page.goto('/bibliotheque');

  await expect(page.getByRole('heading', { name: 'Support distant E2E' })).toBeVisible();
  await expect(page.getByText('La bibliothèque est vide')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Matière distante E2E/ })).toBeVisible();

  await expect.poll(async () => page.evaluate(async (subjectId) => {
    const { db } = await import('/src/data/db.ts');
    return (await db.subjects.get(subjectId))?.syncState ?? null;
  }, SUBJECT_ID)).toBe('synced');

  await page.getByRole('link', { name: /Support distant E2E/ }).click();
  await expect(page.getByText(remoteText)).toBeVisible();
  await page.reload();
  await expect(page.getByText(remoteText)).toBeVisible();
});

test('une panne du bootstrap distant ne devient jamais un faux état vide', async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'BOOTSTRAP_E2E_DOWN',
          message: 'D1 temporairement indisponible.',
          retryable: true,
        },
      }),
    });
  });

  await page.goto('/bibliotheque');

  await expect(page.getByRole('heading', { name: 'Impossible de vérifier les supports synchronisés' })).toBeVisible();
  await expect(page.getByText('La bibliothèque est vide')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toBeVisible();
});

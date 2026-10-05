import { expect, test } from '@playwright/test';

const SUBJECT_ID = '71717171-aaaa-4717-8717-717171717171';
const RESOURCE_ID = '72727272-bbbb-4727-8727-727272727272';
const VERSION_ID = '73737373-cccc-4737-8737-737373737373';
const NOW = '2026-10-05T00:00:00.000Z';

test('un PDF uniquement distant absent de R2 propose une restauration sans erreur PDF.js brute', async ({ page }) => {
  let blobReads = 0;

  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjects: [{ id: SUBJECT_ID, name: 'Matière distante', parentId: null, createdAt: NOW, updatedAt: NOW }],
        resources: [{
          id: RESOURCE_ID,
          subjectId: SUBJECT_ID,
          title: 'PDF distant orphelin',
          kind: 'pdf',
          currentVersionId: VERSION_ID,
          status: 'failed',
          extractionCharCount: null,
          createdAt: NOW,
          updatedAt: NOW,
        }],
      }),
    });
  });

  await page.route(`**/api/resources/${RESOURCE_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subject: { id: SUBJECT_ID, name: 'Matière distante', parentId: null, createdAt: NOW, updatedAt: NOW },
        resource: {
          id: RESOURCE_ID,
          subjectId: SUBJECT_ID,
          title: 'PDF distant orphelin',
          kind: 'pdf',
          currentVersionId: VERSION_ID,
          createdAt: NOW,
          updatedAt: NOW,
        },
        version: {
          id: VERSION_ID,
          fileName: 'orphelin.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          sha256: 'ab'.repeat(32),
          status: 'failed',
          extractionStatus: 'failed',
          extractionError: 'L’extraction doit être revue.',
        },
        extraction: null,
      }),
    });
  });

  await page.route(`**/api/resource-versions/${VERSION_ID}/blob`, async (route) => {
    blobReads += 1;
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'Le fichier n’est pas présent dans le stockage.',
          retryable: true,
        },
      }),
    });
  });

  await page.goto(`/bibliotheque/${RESOURCE_ID}`);

  await expect(page.getByRole('heading', { name: 'PDF distant orphelin' })).toBeVisible();
  await expect(page.locator('.resource-header .eyebrow')).toHaveText('Matière distante');

  const repair = page.getByLabel('Fichier distant à restaurer');
  await expect(repair).toBeVisible();
  await expect(repair.getByText('Le fichier synchronisé doit être restauré.')).toBeVisible();
  await expect(repair.getByText(/son PDF n’est plus présent dans R2/)).toBeVisible();
  await expect(repair.getByRole('link', { name: 'Réimporter depuis la bibliothèque' })).toHaveAttribute('href', '/bibliotheque');

  await expect(page.getByText('Le fichier PDF distant doit être restauré depuis le fichier original.')).toBeVisible();
  await expect(page.getByText('Le fichier PDF distant doit d’abord être restauré depuis le fichier original avant toute nouvelle extraction.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retenter l’extraction avec le serveur' })).toHaveCount(0);
  await expect(page.getByText(/Unexpected server response/)).toHaveCount(0);
  await expect.poll(() => blobReads).toBe(1);
});

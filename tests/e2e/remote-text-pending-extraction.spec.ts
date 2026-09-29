import { expect, test } from '@playwright/test';

const RESOURCE_ID = '81818181-8181-4181-8181-818181818181';
const VERSION_ID = '82828282-8282-4282-8282-828282828282';
const SUBJECT_ID = '83838383-8383-4383-8383-838383838383';

test('un texte distant stocké avec extraction en attente peut être récupéré sur le serveur', async ({ page }) => {
  const extractedText = 'Texte distant récupéré depuis R2 après une extraction interrompue.';
  let recovered = false;
  let extractionRequests = 0;

  await page.route(`**/api/resources/${RESOURCE_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        resource: {
          id: RESOURCE_ID,
          subjectId: SUBJECT_ID,
          title: 'Texte distant à récupérer',
          kind: 'text',
          currentVersionId: VERSION_ID,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:01.000Z',
        },
        version: {
          id: VERSION_ID,
          fileName: 'recuperation.txt',
          mimeType: 'text/plain;charset=utf-8',
          size: extractedText.length,
          sha256: '8'.repeat(64),
          status: recovered ? 'ready' : 'stored',
          extractionStatus: recovered ? 'ready' : 'pending',
          extractionError: null,
        },
        extraction: recovered ? {
          pages: [{ pageNumber: 1, text: extractedText }],
          charCount: extractedText.length,
        } : null,
      }),
    });
  });

  await page.route(`**/api/resource-versions/${VERSION_ID}/server-extraction`, async (route) => {
    extractionRequests += 1;
    recovered = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        pages: [{ pageNumber: 1, text: extractedText }],
        charCount: extractedText.length,
      }),
    });
  });

  await page.goto(`/bibliotheque/${RESOURCE_ID}`);

  await expect(page.getByRole('heading', { name: 'Texte distant à récupérer' })).toBeVisible();
  await expect(page.getByText('Aucun texte extrait n’est disponible.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retenter l’extraction avec le serveur' })).toBeVisible();

  await page.getByRole('button', { name: 'Retenter l’extraction avec le serveur' }).click();

  await expect(page.getByText(extractedText)).toBeVisible();
  await expect(page.getByText('caractères extraits', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retenter l’extraction avec le serveur' })).toHaveCount(0);
  expect(extractionRequests).toBe(1);
});

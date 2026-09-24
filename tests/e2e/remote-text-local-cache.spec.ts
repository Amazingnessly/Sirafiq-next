import { expect, test } from '@playwright/test';

const RESOURCE_ID = '51515151-5151-4151-8151-515151515151';
const VERSION_ID = '61616161-6161-4161-8161-616161616161';
const SUBJECT_ID = '71717171-7171-4171-8171-717171717171';

test('un texte récupéré depuis D1 reste lisible après un reload hors ligne', async ({ page }) => {
  let detailRequests = 0;
  let serverAvailable = true;
  const text = 'Texte synchronisé récupéré une fois puis conservé localement.';

  await page.route('**/api/bootstrap', async (route) => {
    if (!serverAvailable) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'OFFLINE_E2E', message: 'Serveur indisponible', retryable: true } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [], resources: [] }),
    });
  });

  await page.route(`**/api/resources/${RESOURCE_ID}`, async (route) => {
    detailRequests += 1;
    if (!serverAvailable) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'OFFLINE_E2E', message: 'Serveur indisponible', retryable: true } }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subject: {
          id: SUBJECT_ID,
          name: 'Matière D1 réhydratée',
          parentId: null,
          createdAt: '2026-09-22T23:59:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
        },
        resource: {
          id: RESOURCE_ID,
          subjectId: SUBJECT_ID,
          title: 'Texte D1 réhydraté',
          kind: 'text',
          currentVersionId: VERSION_ID,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:01.000Z',
        },
        version: {
          id: VERSION_ID,
          fileName: 'rehydrate.txt',
          mimeType: 'text/plain',
          size: text.length,
          sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          status: 'ready',
          extractionStatus: 'ready',
          extractionError: null,
        },
        extraction: {
          pages: [{ pageNumber: 1, text }],
          charCount: text.length,
        },
      }),
    });
  });

  await page.goto(`/bibliotheque/${RESOURCE_ID}`);
  await expect(page.getByText(text)).toBeVisible();

  await expect.poll(async () => page.evaluate(async ({ resourceId, versionId }) => {
    const { db } = await import('/src/data/db.ts');
    const [subject, resource, version, extraction] = await Promise.all([
      db.subjects.get(SUBJECT_ID),
      db.resources.get(resourceId),
      db.resourceVersions.get(versionId),
      db.extractions.get(versionId),
    ]);
    return {
      subjectName: subject?.name ?? null,
      subjectState: subject?.syncState ?? null,
      resourceState: resource?.syncState,
      versionState: version?.syncState,
      bytes: version ? version.bytes : 'missing',
      extractionStatus: extraction?.status,
      extractedText: extraction?.pages.map((entry) => entry.text).join('') ?? null,
    };
  }, { resourceId: RESOURCE_ID, versionId: VERSION_ID })).toEqual({
    subjectName: 'Matière D1 réhydratée',
    subjectState: 'synced',
    resourceState: 'synced',
    versionState: 'synced',
    bytes: null,
    extractionStatus: 'ready',
    extractedText: text,
  });

  serverAvailable = false;
  await page.reload();

  await expect(page.getByText(text)).toBeVisible();
  await expect(page.getByText('Matière D1 réhydratée')).toBeVisible();
  expect(detailRequests).toBe(1);

  await page.goto('/bibliotheque');
  await expect(page.getByText('Matière D1 réhydratée')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Texte D1 réhydraté' })).toBeVisible();
  await expect(page.getByText('Impossible de vérifier la bibliothèque synchronisée.')).toBeVisible();
});

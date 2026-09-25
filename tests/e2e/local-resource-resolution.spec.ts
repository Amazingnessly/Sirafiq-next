import { expect, test } from '@playwright/test';

test('un support local s’ouvre sans requête distante concurrente', async ({ page }) => {
  await page.goto('/bibliotheque');
  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Local first E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByLabel(/Titre/).fill('Support local prioritaire');
  await page.getByLabel('Contenu').fill('Ce contenu doit être résolu depuis IndexedDB avant tout fallback réseau.');
  await page.getByRole('button', { name: 'Importer le support' }).click();
  await expect(page.getByRole('heading', { name: 'Support local prioritaire' })).toBeVisible();

  let detailRequests = 0;
  await page.route(/\/api\/resources\/[^/?]+(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    detailRequests += 1;
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
  });

  await page.getByRole('heading', { name: 'Support local prioritaire' }).click();
  await expect(page.getByText('Ce contenu doit être résolu depuis IndexedDB avant tout fallback réseau.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Ce contenu doit être résolu depuis IndexedDB avant tout fallback réseau.')).toBeVisible();

  expect(detailRequests).toBe(0);
});


test('une ressource locale dont la version a disparu est reconstruite depuis son identité distante puis redevient local-first', async ({ page }) => {
  const localSubjectId = '61616161-6161-4161-8161-616161616161';
  const localResourceId = '62626262-6262-4262-8262-626262626262';
  const localVersionId = '63636363-6363-4363-8363-636363636363';
  const remoteResourceId = '64646464-6464-4464-8464-646464646464';
  const remoteVersionId = '65656565-6565-4565-8565-656565656565';
  const remoteSubjectId = '66666666-6666-4666-8666-666666666666';
  const recoveredText = 'Version distante utilisée une fois pour reconstruire les métadonnées locales.';
  const sha256 = 'e'.repeat(64);
  let detailRequests = 0;

  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [], resources: [] }),
    });
  });

  await page.route(`**/api/resources/${remoteResourceId}`, async (route) => {
    detailRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subject: {
          id: remoteSubjectId,
          name: 'Matière distante',
          parentId: null,
          createdAt: '2026-09-25T00:00:00.000Z',
          updatedAt: '2026-09-25T00:00:00.000Z',
        },
        resource: {
          id: remoteResourceId,
          subjectId: remoteSubjectId,
          title: 'Titre distant',
          kind: 'text',
          currentVersionId: remoteVersionId,
          createdAt: '2026-09-25T00:00:00.000Z',
          updatedAt: '2026-09-25T00:00:00.000Z',
        },
        version: {
          id: remoteVersionId,
          fileName: 'recovered.txt',
          mimeType: 'text/plain',
          size: recoveredText.length,
          sha256,
          status: 'ready',
          extractionStatus: 'ready',
          extractionError: null,
        },
        extraction: {
          pages: [{ pageNumber: 1, text: recoveredText }],
          charCount: recoveredText.length,
        },
      }),
    });
  });

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ subjectId, resourceId, versionId, remoteId }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    await db.subjects.add({
      id: subjectId,
      name: 'Matière locale conservée',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'Ressource locale conservée',
      kind: 'text',
      currentVersionId: versionId,
      remoteResourceId: remoteId,
      status: 'ready',
      extractionError: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
  }, {
    subjectId: localSubjectId,
    resourceId: localResourceId,
    versionId: localVersionId,
    remoteId: remoteResourceId,
  });

  await page.goto(`/bibliotheque/${localResourceId}`);

  await expect(page.getByRole('heading', { name: 'Ressource locale conservée' })).toBeVisible();
  await expect(page.getByText(recoveredText)).toBeVisible();
  expect(detailRequests).toBe(1);

  await expect.poll(async () => page.evaluate(async ({ resourceId, versionId, remoteVersionId, expectedText }) => {
    const { db } = await import('/src/data/db.ts');
    const [resource, version, extraction] = await Promise.all([
      db.resources.get(resourceId),
      db.resourceVersions.get(versionId),
      db.extractions.get(versionId),
    ]);
    return {
      resourceId: resource?.id ?? null,
      versionId: version?.id ?? null,
      remoteVersionId: version?.remoteVersionId ?? null,
      versionResourceId: version?.resourceId ?? null,
      bytes: version ? version.bytes : 'missing',
      extractionStatus: extraction?.status ?? null,
      extractedText: extraction?.pages[0]?.text ?? null,
    };
  }, {
    resourceId: localResourceId,
    versionId: localVersionId,
    remoteVersionId,
    expectedText: recoveredText,
  })).toEqual({
    resourceId: localResourceId,
    versionId: localVersionId,
    remoteVersionId,
    versionResourceId: localResourceId,
    bytes: null,
    extractionStatus: 'ready',
    extractedText: recoveredText,
  });

  await page.reload();

  await expect(page.getByText(recoveredText)).toBeVisible();
  await expect(page.getByText('Matière locale conservée')).toBeVisible();
  expect(detailRequests).toBe(1);
});

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

test('un détail distant incompatible n’est jamais affiché pour une ressource locale dont la version a disparu', async ({ page }) => {
  const localSubjectId = '71717171-7171-4171-8171-717171717171';
  const localResourceId = '72727272-7272-4272-8272-727272727272';
  const localVersionId = '73737373-7373-4373-8373-737373737373';
  const remoteResourceId = '74747474-7474-4474-8474-747474747474';
  const remoteVersionId = '75757575-7575-4575-8575-757575757575';
  const remoteSubjectId = '76767676-7676-4676-8676-767676767676';
  const incompatibleText = 'Ce contenu distant incompatible ne doit jamais être associé au support local.';

  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [], resources: [] }),
    });
  });

  await page.route(`**/api/resources/${remoteResourceId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subject: {
          id: remoteSubjectId,
          name: 'Matière distante incompatible',
          parentId: null,
          createdAt: '2026-09-28T00:00:00.000Z',
          updatedAt: '2026-09-28T00:00:00.000Z',
        },
        resource: {
          id: remoteResourceId,
          subjectId: remoteSubjectId,
          title: 'PDF distant incompatible',
          kind: 'pdf',
          currentVersionId: remoteVersionId,
          createdAt: '2026-09-28T00:00:00.000Z',
          updatedAt: '2026-09-28T00:00:00.000Z',
        },
        version: {
          id: remoteVersionId,
          fileName: 'incompatible.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          sha256: 'f'.repeat(64),
          status: 'ready',
          extractionStatus: 'ready',
          extractionError: null,
        },
        extraction: {
          pages: [{ pageNumber: 1, text: incompatibleText }],
          charCount: incompatibleText.length,
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
      name: 'Matière locale intacte',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'Texte local sans version',
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

  await expect(page.getByRole('heading', { name: 'Impossible de reconstruire la version du support' })).toBeVisible();
  await expect(page.getByText(/Le détail synchronisé ne correspond pas à l’identité locale conservée/)).toBeVisible();
  await expect(page.getByText(incompatibleText)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Réessayer' })).toHaveCount(0);

  const localVersion = await page.evaluate(async (versionId) => {
    const { db } = await import('/src/data/db.ts');
    return db.resourceVersions.get(versionId);
  }, localVersionId);
  expect(localVersion).toBeUndefined();
});

test('une incohérence terminale du détail distant n’est pas présentée comme une panne réessayable', async ({ page }) => {
  const resourceId = '81818181-8181-4181-8181-818181818181';
  const message = 'Ce support synchronisé existe, mais sa version courante est absente de D1.';
  let detailRequests = 0;

  await page.route(`**/api/resources/${resourceId}`, async (route) => {
    detailRequests += 1;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'RESOURCE_VERSION_MISSING',
          message,
          retryable: false,
        },
      }),
    });
  });

  await page.goto(`/bibliotheque/${resourceId}`);

  await expect(page.getByRole('heading', { name: 'Impossible de charger le support' })).toBeVisible();
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Support introuvable' })).toHaveCount(0);
  await expect.poll(() => detailRequests).toBe(1);
});

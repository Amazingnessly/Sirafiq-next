import { expect, test } from '@playwright/test';

test('une extraction locale failed n’affiche jamais d’anciennes pages conservées', async ({ page }) => {
  const subjectId = 'a1111111-1111-4111-8111-111111111111';
  const resourceId = 'a2222222-2222-4222-8222-222222222222';
  const versionId = 'a3333333-3333-4333-8333-333333333333';
  const staleText = 'Ancien texte local qui ne doit plus être utilisé.';

  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [], resources: [] }),
    });
  });

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ subjectId: sid, resourceId: rid, versionId: vid, stale }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    const bytes = new TextEncoder().encode(stale).buffer;
    await db.transaction('rw', db.subjects, db.resources, db.resourceVersions, db.extractions, async () => {
      await db.subjects.put({
        id: sid,
        name: 'Extraction locale incohérente',
        parentId: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'synced',
        syncError: null,
      });
      await db.resources.put({
        id: rid,
        subjectId: sid,
        title: 'Texte local en échec',
        kind: 'text',
        currentVersionId: vid,
        status: 'failed',
        extractionError: 'Extraction échouée.',
        createdAt: now,
        updatedAt: now,
        syncState: 'synced',
        syncError: null,
      });
      await db.resourceVersions.put({
        id: vid,
        resourceId: rid,
        sha256: '1'.repeat(64),
        fileName: 'stale-local.txt',
        mimeType: 'text/plain',
        size: bytes.byteLength,
        bytes,
        createdAt: now,
        syncState: 'synced',
        syncError: null,
      });
      await db.extractions.put({
        versionId: vid,
        status: 'failed',
        pages: [{ pageNumber: 1, text: stale }],
        charCount: stale.length,
        errorCode: 'STALE_E2E',
        errorMessage: 'Extraction échouée.',
        createdAt: now,
      });
    });
  }, { subjectId, resourceId, versionId, stale: staleText });

  await page.goto(`/bibliotheque/${resourceId}`);

  await expect(page.getByText(staleText)).toHaveCount(0);
  await expect(page.getByText('Aucun texte extrait n’est disponible.')).toBeVisible();
  await expect(page.getByText('caractères extraits', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Récupération de l’extraction')).toBeVisible();
});

test('une réponse distante failed ignore une extraction stale encore présente', async ({ page }) => {
  const resourceId = 'b2222222-2222-4222-8222-222222222222';
  const versionId = 'b3333333-3333-4333-8333-333333333333';
  const subjectId = 'b1111111-1111-4111-8111-111111111111';
  const staleText = 'Ancien texte distant qui ne doit plus être utilisé.';

  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [], resources: [] }),
    });
  });
  await page.route(`**/api/resources/${resourceId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        resource: {
          id: resourceId,
          subjectId,
          title: 'Texte distant en échec',
          kind: 'text',
          currentVersionId: versionId,
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:01.000Z',
        },
        version: {
          id: versionId,
          fileName: 'stale-remote.txt',
          mimeType: 'text/plain',
          size: staleText.length,
          sha256: '2'.repeat(64),
          status: 'failed',
          extractionStatus: 'failed',
          extractionError: 'STALE_E2E: extraction échouée',
        },
        extraction: {
          pages: [{ pageNumber: 1, text: staleText }],
          charCount: staleText.length,
        },
      }),
    });
  });

  await page.goto(`/bibliotheque/${resourceId}`);

  await expect(page.getByText(staleText)).toHaveCount(0);
  await expect(page.getByText('Aucun texte extrait n’est disponible.')).toBeVisible();
  await expect(page.getByText('caractères extraits', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retenter l’extraction avec le serveur' })).toBeVisible();
});

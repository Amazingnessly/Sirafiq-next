import { expect, test, type Page } from '@playwright/test';

async function seedLocalSupport(page: Page) {
  await page.goto('/bibliotheque');
  await page.evaluate(async () => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    const subjectId = '71717171-1111-4111-8111-717171717171';
    const resourceId = '72727272-2222-4222-8222-727272727272';
    const versionId = '73737373-3333-4333-8333-737373737373';
    const text = 'Support local qui ne doit jamais être précédé par un faux état vide.';
    const bytes = new TextEncoder().encode(text).buffer;

    await db.transaction('rw', db.subjects, db.resources, db.resourceVersions, db.extractions, async () => {
      await db.subjects.put({
        id: subjectId,
        name: 'Chargement local E2E',
        parentId: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'synced',
        syncError: null,
      });
      await db.resources.put({
        id: resourceId,
        subjectId,
        title: 'Support local au reload',
        kind: 'text',
        currentVersionId: versionId,
        status: 'ready',
        extractionError: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'synced',
        syncError: null,
      });
      await db.resourceVersions.put({
        id: versionId,
        resourceId,
        sha256: 'f'.repeat(64),
        fileName: 'reload.txt',
        mimeType: 'text/plain',
        size: bytes.byteLength,
        bytes,
        createdAt: now,
        syncState: 'synced',
        syncError: null,
      });
      await db.extractions.put({
        versionId,
        status: 'ready',
        pages: [{ pageNumber: 1, text }],
        charCount: text.length,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
      });
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [], resources: [] }),
    });
  });
});

test('la bibliothèque distingue le chargement IndexedDB d’un état vide au reload', async ({ page }) => {
  await seedLocalSupport(page);

  await page.reload({ waitUntil: 'commit' });

  await expect(page.getByRole('status').filter({ hasText: 'Chargement de la bibliothèque locale' })).toBeVisible();
  await expect(page.getByText('La bibliothèque est vide')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Support local au reload' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Chargement de la bibliothèque locale' })).toHaveCount(0);
});

test('l’accueil attend sa première lecture IndexedDB avant de proposer un onboarding vide', async ({ page }) => {
  await seedLocalSupport(page);

  await page.goto('/', { waitUntil: 'commit' });

  await expect(page.getByRole('status').filter({ hasText: 'Chargement de ma bibliothèque locale' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Créer ma première matière' })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Continuer à partir de mes supports' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reprendre mes supports' })).toBeVisible();
});

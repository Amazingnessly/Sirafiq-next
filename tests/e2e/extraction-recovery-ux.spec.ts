import { expect, test, type Page } from '@playwright/test';

const RESOURCE_ID = '71717171-7171-4717-8717-717171717171';
const VERSION_ID = '81818181-8181-4818-8818-818181818181';
const SUBJECT_ID = '91919191-9191-4919-8919-919191919191';

async function seedFailedPdf(page: Page, syncState: 'synced' | 'error') {
  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId, versionId, subjectId, state }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    await db.subjects.add({
      id: subjectId,
      name: 'PDF récupération',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'PDF extraction à reprendre',
      kind: 'pdf',
      currentVersionId: versionId,
      status: 'failed',
      extractionError: 'Le contenu n’a pas pu être extrait sur cet appareil.',
      createdAt: now,
      updatedAt: now,
      syncState: state,
      syncError: state === 'error' ? 'Synchronisation interrompue.' : null,
    });
    await db.resourceVersions.add({
      id: versionId,
      resourceId,
      sha256: 'a'.repeat(64),
      fileName: 'extraction.pdf',
      mimeType: 'application/pdf',
      size: 9 * 1024 * 1024,
      bytes: null,
      createdAt: now,
      syncState: state,
      syncError: state === 'error' ? 'Synchronisation interrompue.' : null,
    });
    await db.extractions.add({
      versionId,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'UNREADABLE_PDF',
      errorMessage: 'Le contenu n’a pas pu être extrait sur cet appareil.',
      createdAt: now,
    });
  }, { resourceId: RESOURCE_ID, versionId: VERSION_ID, subjectId: SUBJECT_ID, state: syncState });
}

test('un PDF synchronisé expose la reprise serveur dans État réel puis applique le résultat', async ({ page }) => {
  const extractedText = 'Texte réellement récupéré après une relance explicite.';

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/resource-versions/${VERSION_ID}/blob`) {
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF\n' });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, uploadMode: 'single' }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/server-extraction`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          pages: [{ pageNumber: 1, text: extractedText }],
          charCount: extractedText.length,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route de test absente.', retryable: false } }),
    });
  });

  await seedFailedPdf(page, 'synced');
  await page.goto(`/bibliotheque/${RESOURCE_ID}`);

  const recovery = page.getByLabel('Récupération de l’extraction');
  await expect(recovery).toBeVisible();
  const retry = recovery.getByRole('button', { name: 'Retenter l’extraction avec le serveur' });
  await expect(retry).toBeVisible();
  await retry.click();

  await expect(page.getByText('caractères extraits', { exact: true })).toBeVisible();
  await expect(page.getByText(extractedText, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Récupération de l’extraction')).toHaveCount(0);
});

test('un PDF non synchronisé explique pourquoi la reprise serveur est indisponible', async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
  });

  await seedFailedPdf(page, 'error');
  await page.goto(`/bibliotheque/${RESOURCE_ID}`);

  const recovery = page.getByLabel('Récupération de l’extraction');
  await expect(recovery).toBeVisible();
  await expect(recovery.getByText('Le PDF doit d’abord être entièrement synchronisé avant qu’une extraction serveur puisse être relancée.')).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Retenter l’extraction avec le serveur' })).toHaveCount(0);
});

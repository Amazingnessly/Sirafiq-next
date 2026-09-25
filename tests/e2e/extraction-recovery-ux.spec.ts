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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, uploadMode: 'single', alreadyStored: true }),
      });
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
  await expect(page.getByLabel('Récupération de l’extraction')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(async ({ versionId, expectedText }) => {
    const { db } = await import('/src/data/db.ts');
    const extraction = await db.extractions.get(versionId);
    return extraction?.status === 'ready'
      && extraction.charCount === expectedText.length
      && extraction.pages[0]?.text === expectedText;
  }, { versionId: VERSION_ID, expectedText: extractedText })).toBe(true);
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


test('une extraction locale absente peut être reconstruite depuis le serveur', async ({ page }) => {
  const resourceId = '41414141-4141-4141-8141-414141414141';
  const versionId = '42424242-4242-4242-8242-424242424242';
  const subjectId = '43434343-4343-4343-8343-434343434343';
  const extractedText = 'Extraction reconstruite depuis le serveur après perte de l’enregistrement local.';
  let serverExtractionCalls = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, uploadMode: 'single', alreadyStored: true }),
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${versionId}/server-extraction`) {
      serverExtractionCalls += 1;
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

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId: rid, versionId: vid, subjectId: sid }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    await db.subjects.add({
      id: sid,
      name: 'Extraction locale manquante',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: rid,
      subjectId: sid,
      title: 'Texte à reconstruire',
      kind: 'text',
      currentVersionId: vid,
      status: 'failed',
      extractionError: 'L’enregistrement local d’extraction est absent.',
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: vid,
      resourceId: rid,
      sha256: 'c'.repeat(64),
      fileName: 'reconstruction.txt',
      mimeType: 'text/plain',
      size: 1024,
      bytes: null,
      createdAt: now,
      syncState: 'synced',
      syncError: null,
    });
  }, { resourceId, versionId, subjectId });

  await page.goto(`/bibliotheque/${resourceId}`);

  const recovery = page.getByLabel('Récupération de l’extraction');
  await expect(recovery).toBeVisible();
  const retry = recovery.getByRole('button', { name: 'Retenter l’extraction avec le serveur' });
  await expect(retry).toBeVisible();
  await retry.click();

  await expect(page.getByText(extractedText)).toBeVisible();
  await expect(page.getByLabel('Récupération de l’extraction')).toHaveCount(0);
  expect(serverExtractionCalls).toBe(1);

  await expect.poll(async () => page.evaluate(async ({ rid, vid }) => {
    const { db } = await import('/src/data/db.ts');
    const [resource, extraction] = await Promise.all([
      db.resources.get(rid),
      db.extractions.get(vid),
    ]);
    return {
      resourceStatus: resource?.status,
      extractionStatus: extraction?.status,
      extractedText: extraction?.pages[0]?.text ?? null,
    };
  }, { rid: resourceId, vid: versionId })).toEqual({
    resourceStatus: 'ready',
    extractionStatus: 'ready',
    extractedText,
  });
});


test('une relance d’extraction répare d’abord R2 avec les octets locaux quand le serveur les a perdus', async ({ page }) => {
  const resourceId = '51515151-5151-4151-8151-515151515151';
  const versionId = '52525252-5252-4252-8252-525252525252';
  const subjectId = '53535353-5353-4353-8353-535353535353';
  const content = 'Copie locale disponible pour réparer le stockage distant.';
  const extractedText = 'Extraction serveur après réparation réelle du fichier distant.';
  const hash = 'd'.repeat(64);
  let blobUploads = 0;
  let serverExtractionCalls = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, uploadMode: 'single', alreadyStored: false }),
      });
      return;
    }
    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${versionId}/blob`) {
      blobUploads += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${versionId}/server-extraction`) {
      serverExtractionCalls += 1;
      expect(blobUploads).toBe(1);
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

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId: rid, versionId: vid, subjectId: sid, content: value, sha256 }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    const bytes = new TextEncoder().encode(value).buffer;

    await db.subjects.add({
      id: sid,
      name: 'Réparation stockage avant extraction',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: rid,
      subjectId: sid,
      title: 'Texte stockage distant perdu',
      kind: 'text',
      currentVersionId: vid,
      status: 'failed',
      extractionError: 'Extraction à relancer.',
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: vid,
      resourceId: rid,
      sha256,
      fileName: 'repair-before-extract.txt',
      mimeType: 'text/plain',
      size: bytes.byteLength,
      bytes,
      createdAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.extractions.add({
      versionId: vid,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'REMOTE_STORAGE_LOST',
      errorMessage: 'Extraction à relancer.',
      createdAt: now,
    });
  }, { resourceId, versionId, subjectId, content, sha256: hash });

  await page.goto(`/bibliotheque/${resourceId}`);
  const retry = page.getByLabel('Récupération de l’extraction')
    .getByRole('button', { name: 'Retenter l’extraction avec le serveur' });
  await expect(retry).toBeVisible();
  await retry.click();

  await expect(page.getByText(extractedText)).toBeVisible();
  expect(blobUploads).toBe(1);
  expect(serverExtractionCalls).toBe(1);
});

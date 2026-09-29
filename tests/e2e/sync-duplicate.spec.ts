import { expect, test } from '@playwright/test';

test('un doublon déjà synchronisé est réutilisé puis extrait sans réenvoyer le fichier', async ({ page }) => {
  let uploadAttempts = 0;
  const blobReadPaths: string[] = [];
  const extractedText = 'Texte récupéré depuis la version distante déjà synchronisée.';
  let exposeRemoteBootstrap = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(exposeRemoteBootstrap ? {
          subjects: [{
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Matière distante originale',
            parentId: null,
            createdAt: '2026-08-22T00:00:00.000Z',
            updatedAt: '2026-08-22T00:00:00.000Z',
          }],
          resources: [{
            id: '11111111-1111-4111-8111-111111111111',
            subjectId: '22222222-2222-4222-8222-222222222222',
            title: 'PDF déjà présent',
            kind: 'pdf',
            currentVersionId: '33333333-3333-4333-8333-333333333333',
            status: 'stored',
            extractionCharCount: null,
            createdAt: '2026-08-22T00:00:00.000Z',
            updatedAt: '2026-08-22T00:00:00.000Z',
          }],
        } : { subjects: [], resources: [] }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/subjects/upsert') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      exposeRemoteBootstrap = true;
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'DUPLICATE_SUPPORT',
            message: 'Ce fichier existe déjà dans la bibliothèque synchronisée.',
            retryable: false,
            details: { existingResourceId: '11111111-1111-4111-8111-111111111111' },
          },
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === '/api/resources/11111111-1111-4111-8111-111111111111') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resource: {
            id: '11111111-1111-4111-8111-111111111111',
            subjectId: '22222222-2222-4222-8222-222222222222',
            title: 'PDF déjà présent',
            kind: 'pdf',
            currentVersionId: '33333333-3333-4333-8333-333333333333',
            createdAt: '2026-08-22T00:00:00.000Z',
            updatedAt: '2026-08-22T00:00:00.000Z',
          },
          version: {
            id: '33333333-3333-4333-8333-333333333333',
            fileName: 'duplicate.pdf',
            mimeType: 'application/pdf',
            size: 1024,
            sha256: 'a'.repeat(64),
            status: 'stored',
            extractionStatus: 'failed',
            extractionError: 'Extraction locale impossible',
          },
          extraction: null,
        }),
      });
      return;
    }

    if (request.method() === 'GET' && /^\/api\/resource-versions\/[^/]+\/blob$/.test(url.pathname)) {
      blobReadPaths.push(url.pathname);
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
      return;
    }

    if (request.method() === 'PUT' && url.pathname.includes('/blob')) {
      uploadAttempts += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/resource-versions/33333333-3333-4333-8333-333333333333/server-extraction') {
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

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Test route missing', retryable: false } }) });
  });

  await page.goto('/bibliotheque');
  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Doublon serveur E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('listitem').getByText('Doublon serveur E2E', { exact: true })).toBeVisible();

  await page.getByLabel(/Titre/).fill('PDF doublon distant');
  await page.getByLabel('Fichier du support').setInputFiles({
    name: 'duplicate.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nPDF volontairement invalide pour forcer le fallback serveur'),
  });
  await page.getByRole('button', { name: 'Importer le support' }).click();
  await expect(page.getByRole('heading', { name: 'PDF doublon distant' })).toBeVisible();
  await page.getByRole('heading', { name: 'PDF doublon distant' }).click();

  await expect(page.getByText('Synchronisé', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('caractères extraits', { exact: true })).toBeVisible();
  await expect(page.getByText('Le support est enregistré localement, mais la synchronisation a échoué.')).toHaveCount(0);
  expect(uploadAttempts).toBe(0);

  const remoteIdentity = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sirafiq-next');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('resourceVersions', 'readwrite');
    const store = transaction.objectStore('resourceVersions');
    const versions = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
      request.onerror = () => reject(request.error);
    });
    const version = versions[0];
    if (!version || typeof version.id !== 'string') throw new Error('Version locale E2E introuvable');
    const reconciledId = typeof version.remoteVersionId === 'string' ? version.remoteVersionId : null;
    store.put({ ...version, bytes: null });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Transaction E2E annulée'));
    });
    const resourceTransaction = database.transaction('resources', 'readonly');
    const resourcesStore = resourceTransaction.objectStore('resources');
    const resources = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = resourcesStore.getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      resourceTransaction.oncomplete = () => resolve();
      resourceTransaction.onerror = () => reject(resourceTransaction.error);
    });
    database.close();
    const localResource = resources.find((item) => item.title === 'PDF doublon distant');
    return {
      remoteVersionId: reconciledId,
      remoteResourceId: typeof localResource?.remoteResourceId === 'string' ? localResource.remoteResourceId : null,
    };
  });

  expect(remoteIdentity.remoteVersionId).toBe('33333333-3333-4333-8333-333333333333');
  expect(remoteIdentity.remoteResourceId).toBe('11111111-1111-4111-8111-111111111111');
  await expect.poll(() => blobReadPaths).toContain('/api/resource-versions/33333333-3333-4333-8333-333333333333/blob');
  blobReadPaths.length = 0;
  await page.reload();
  await expect.poll(() => blobReadPaths).toContain('/api/resource-versions/33333333-3333-4333-8333-333333333333/blob');

  await page.getByRole('link', { name: '← Bibliothèque', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PDF doublon distant' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'PDF déjà présent' })).toHaveCount(0);
});

import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const MIB = 1024 * 1024;
const RESOURCE_ID = '44444444-4444-4444-8444-444444444444';
const VERSION_ID = '55555555-5555-4555-8555-555555555555';
const SUBJECT_ID = '66666666-6666-4666-8666-666666666666';

test('reprend un multipart interrompu sans renvoyer les morceaux déjà confirmés', async ({ page }) => {
  const fileBytes = Buffer.alloc(11 * MIB, 7);
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');
  const uploadedParts: number[] = [];
  let completeCalled = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, uploadMode: 'multipart' }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/create`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uploadId: 'upload-existing', partSize: 5 * MIB, parts: [{ partNumber: 1, etag: 'etag-1' }] }),
      });
      return;
    }
    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/part`) {
      const partNumber = Number(url.searchParams.get('partNumber'));
      uploadedParts.push(partNumber);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ partNumber, etag: `etag-${partNumber}` }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/complete`) {
      completeCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, size: fileBytes.length, etag: 'final-etag' }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/extraction-failure`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/resource-versions/${VERSION_ID}/blob`) {
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n' });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route de test absente.', retryable: false } }),
    });
  });

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId, versionId, subjectId, hash, size }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    await db.subjects.add({ id: subjectId, name: 'Gros supports', parentId: null, createdAt: now, updatedAt: now, syncState: 'synced', syncError: null });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'PDF multipart interrompu',
      kind: 'pdf',
      currentVersionId: versionId,
      status: 'failed',
      extractionError: 'Extraction différée pour gros fichier.',
      createdAt: now,
      updatedAt: now,
      syncState: 'error',
      syncError: 'Connexion interrompue pendant le transfert.',
    });
    await db.resourceVersions.add({
      id: versionId,
      resourceId,
      sha256: hash,
      fileName: 'multipart.pdf',
      mimeType: 'application/pdf',
      size,
      bytes: null,
      createdAt: now,
      syncState: 'error',
      syncError: 'Connexion interrompue pendant le transfert.',
    });
    await db.extractions.add({
      versionId,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'LARGE_FILE_EXTRACTION_DEFERRED',
      errorMessage: 'Extraction différée pour gros fichier.',
      createdAt: now,
    });
    await db.multipartUploads.add({
      versionId,
      resourceId,
      fileName: 'multipart.pdf',
      size,
      lastModified: 0,
      sha256: hash,
      uploadId: 'upload-existing',
      partSize: 5 * 1024 * 1024,
      parts: [{ partNumber: 1, etag: 'etag-1' }],
      status: 'error',
      error: 'Connexion interrompue pendant le transfert.',
      updatedAt: now,
    });
  }, { resourceId: RESOURCE_ID, versionId: VERSION_ID, subjectId: SUBJECT_ID, hash: sha256, size: fileBytes.length });

  await page.goto(`/bibliotheque/${RESOURCE_ID}`);
  await expect(page.getByText('L’envoi du gros fichier est interrompu.')).toBeVisible();

  await page.getByLabel('Fichier à reprendre').setInputFiles({ name: 'multipart.pdf', mimeType: 'application/pdf', buffer: fileBytes });
  await page.getByRole('button', { name: 'Reprendre l’envoi' }).click();

  await expect.poll(async () => page.evaluate(async (versionId) => {
    const { db } = await import('/src/data/db.ts');
    return Boolean(await db.multipartUploads.get(versionId));
  }, VERSION_ID), { timeout: 30_000 }).toBe(false);

  expect(uploadedParts).toEqual([2, 3]);
  expect(completeCalled).toBe(true);
  await expect(page.getByText('L’envoi du gros fichier est interrompu.')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(async (resourceId) => {
    const { db } = await import('/src/data/db.ts');
    return (await db.resources.get(resourceId))?.syncState;
  }, RESOURCE_ID)).toBe('synced');
});

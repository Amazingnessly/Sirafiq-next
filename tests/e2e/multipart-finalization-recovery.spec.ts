import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const MIB = 1024 * 1024;
const RESOURCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUBJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function seedInterruptedMultipart(page: Parameters<typeof test>[0]['page'], fileBytes: Buffer) {
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');
  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId, versionId, subjectId, hash, size }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    await db.subjects.add({ id: subjectId, name: 'Gros supports', parentId: null, createdAt: now, updatedAt: now, syncState: 'synced', syncError: null });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'PDF finalisation incertaine',
      kind: 'pdf',
      currentVersionId: versionId,
      status: 'failed',
      extractionError: 'Extraction différée pour gros fichier.',
      createdAt: now,
      updatedAt: now,
      syncState: 'error',
      syncError: 'La finalisation précédente est incertaine.',
    });
    await db.resourceVersions.add({
      id: versionId,
      resourceId,
      sha256: hash,
      fileName: 'finalisation.pdf',
      mimeType: 'application/pdf',
      size,
      bytes: null,
      createdAt: now,
      syncState: 'error',
      syncError: 'La finalisation précédente est incertaine.',
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
      fileName: 'finalisation.pdf',
      size,
      lastModified: 0,
      sha256: hash,
      uploadId: 'upload-old',
      partSize: 5 * 1024 * 1024,
      parts: [
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: 'etag-2' },
        { partNumber: 3, etag: 'etag-3' },
      ],
      status: 'error',
      error: 'Réponse de finalisation perdue.',
      updatedAt: now,
    });
  }, { resourceId: RESOURCE_ID, versionId: VERSION_ID, subjectId: SUBJECT_ID, hash: sha256, size: fileBytes.length });
}

test('une réponse de finalisation perdue est réconciliée sans renvoyer le fichier', async ({ page }) => {
  const fileBytes = Buffer.alloc(11 * MIB, 3);
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');
  let completeCalls = 0;
  let partUploads = 0;
  let restartCreates = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/resources/${RESOURCE_ID}`) {
      const stored = completeCalls >= 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resource: { id: RESOURCE_ID, subjectId: SUBJECT_ID, title: 'PDF finalisation incertaine', kind: 'pdf', currentVersionId: VERSION_ID, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
          version: { id: VERSION_ID, fileName: 'finalisation.pdf', mimeType: 'application/pdf', size: fileBytes.length, sha256, status: stored ? 'stored' : 'uploading', extractionStatus: 'pending', extractionError: null },
          extraction: null,
        }),
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, uploadMode: 'multipart' }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/create`) {
      const body = request.postDataJSON() as { restart?: boolean };
      if (body.restart) restartCreates += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uploadId: 'upload-old', partSize: 5 * MIB, parts: [{ partNumber: 1, etag: 'etag-1' }, { partNumber: 2, etag: 'etag-2' }, { partNumber: 3, etag: 'etag-3' }] }) });
      return;
    }
    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/part`) {
      partUploads += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/complete`) {
      completeCalls += 1;
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'MULTIPART_COMPLETE_FAILED', message: 'Réponse perdue après assemblage.', retryable: true } }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/extraction-failure`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route de test absente.', retryable: false } }) });
  });

  await seedInterruptedMultipart(page, fileBytes);
  await page.goto(`/bibliotheque/${RESOURCE_ID}`);
  await page.getByLabel('Fichier à reprendre').setInputFiles({ name: 'finalisation.pdf', mimeType: 'application/pdf', buffer: fileBytes });
  await page.getByRole('button', { name: 'Reprendre l’envoi' }).click();

  await expect.poll(async () => page.evaluate(async (versionId) => {
    const { db } = await import('/src/data/db.ts');
    return Boolean(await db.multipartUploads.get(versionId));
  }, VERSION_ID), { timeout: 30_000 }).toBe(false);

  expect(completeCalls).toBe(1);
  expect(partUploads).toBe(0);
  expect(restartCreates).toBe(0);
  await expect.poll(async () => page.evaluate(async (resourceId) => {
    const { db } = await import('/src/data/db.ts');
    return (await db.resources.get(resourceId))?.syncState;
  }, RESOURCE_ID)).toBe('synced');
});

test('une session expirée pendant la finalisation redémarre une seule fois proprement', async ({ page }) => {
  const fileBytes = Buffer.alloc(11 * MIB, 5);
  let resourceReads = 0;
  let completeCalls = 0;
  let restartCreates = 0;
  let freshSession = false;
  const uploadedParts: number[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/resources/${RESOURCE_ID}`) {
      resourceReads += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resource: { id: RESOURCE_ID, subjectId: SUBJECT_ID, title: 'PDF finalisation incertaine', kind: 'pdf', currentVersionId: VERSION_ID, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
          version: { id: VERSION_ID, fileName: 'finalisation.pdf', mimeType: 'application/pdf', size: fileBytes.length, sha256: createHash('sha256').update(fileBytes).digest('hex'), status: 'uploading', extractionStatus: 'pending', extractionError: null },
          extraction: null,
        }),
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, uploadMode: 'multipart' }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/create`) {
      const body = request.postDataJSON() as { restart?: boolean };
      if (body.restart) {
        restartCreates += 1;
        freshSession = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uploadId: 'upload-fresh', partSize: 5 * MIB, parts: [] }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(freshSession
          ? { uploadId: 'upload-fresh', partSize: 5 * MIB, parts: [] }
          : { uploadId: 'upload-old', partSize: 5 * MIB, parts: [{ partNumber: 1, etag: 'etag-1' }, { partNumber: 2, etag: 'etag-2' }, { partNumber: 3, etag: 'etag-3' }] }),
      });
      return;
    }
    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/part`) {
      const partNumber = Number(url.searchParams.get('partNumber'));
      uploadedParts.push(partNumber);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ partNumber, etag: `fresh-etag-${partNumber}` }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/complete`) {
      completeCalls += 1;
      if (completeCalls === 1) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'MULTIPART_COMPLETE_FAILED', message: 'La session R2 a expiré.', retryable: true } }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, size: fileBytes.length, etag: 'final-etag' }) });
      }
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/extraction-failure`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route de test absente.', retryable: false } }) });
  });

  await seedInterruptedMultipart(page, fileBytes);
  await page.goto(`/bibliotheque/${RESOURCE_ID}`);
  await page.getByLabel('Fichier à reprendre').setInputFiles({ name: 'finalisation.pdf', mimeType: 'application/pdf', buffer: fileBytes });
  await page.getByRole('button', { name: 'Reprendre l’envoi' }).click();

  await expect.poll(async () => page.evaluate(async (versionId) => {
    const { db } = await import('/src/data/db.ts');
    return Boolean(await db.multipartUploads.get(versionId));
  }, VERSION_ID), { timeout: 30_000 }).toBe(false);

  expect(resourceReads).toBeGreaterThanOrEqual(2);
  expect(completeCalls).toBe(2);
  expect(restartCreates).toBe(1);
  expect(uploadedParts).toEqual([1, 2, 3]);
  await expect.poll(async () => page.evaluate(async (resourceId) => {
    const { db } = await import('/src/data/db.ts');
    return (await db.resources.get(resourceId))?.syncState;
  }, RESOURCE_ID)).toBe('synced');
});

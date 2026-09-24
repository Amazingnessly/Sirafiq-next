import { expect, test } from '@playwright/test';

const SUBJECT_ID = '15151515-1515-4515-8515-151515151515';
const RESOURCE_ID = '16161616-1616-4616-8616-161616161616';
const VERSION_ID = '17171717-1717-4717-8717-171717171717';

test('un objet simple déjà durable dans R2 est réconcilié sans second PUT', async ({ page }) => {
  let uploadAttempts = 0;
  let extractionUploads = 0;
  let registrations = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subjects: [], resources: [] }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      registrations += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, uploadMode: 'single', alreadyStored: true }),
      });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${VERSION_ID}/blob`) {
      uploadAttempts += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/extraction`) {
      extractionUploads += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route E2E absente.', retryable: false } }),
    });
  });

  await page.goto('/bibliotheque');

  await page.evaluate(async ({ subjectId, resourceId, versionId }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    const bytes = new TextEncoder().encode('Texte local déjà envoyé dans R2.').buffer;

    await db.subjects.add({
      id: subjectId,
      name: 'Récupération PUT simple',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'Texte déjà durable dans R2',
      kind: 'text',
      currentVersionId: versionId,
      status: 'ready',
      extractionError: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'error',
      syncError: 'La réponse de stockage a été perdue.',
    });
    await db.resourceVersions.add({
      id: versionId,
      resourceId,
      sha256: 'a'.repeat(64),
      fileName: 'deja-stocke.txt',
      mimeType: 'text/plain',
      size: bytes.byteLength,
      bytes,
      createdAt: now,
      syncState: 'error',
      syncError: 'La réponse de stockage a été perdue.',
    });
    await db.extractions.add({
      versionId,
      status: 'ready',
      pages: [{ pageNumber: 1, text: 'Texte local déjà envoyé dans R2.' }],
      charCount: 'Texte local déjà envoyé dans R2.'.length,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
    });
    await db.outbox.add({
      id: 'single-upload-recovery-outbox',
      type: 'resource.sync',
      entityId: resourceId,
      attempts: 1,
      nextAttemptAt: Date.now(),
      lastError: 'La réponse de stockage a été perdue.',
      createdAt: now,
    });
  }, { subjectId: SUBJECT_ID, resourceId: RESOURCE_ID, versionId: VERSION_ID });

  await page.evaluate(async () => {
    const { requestSync } = await import('/src/lib/sync.ts');
    await requestSync();
  });

  expect(registrations).toBe(1);
  expect(uploadAttempts).toBe(0);
  expect(extractionUploads).toBe(1);

  await expect.poll(async () => page.evaluate(async ({ resourceId, versionId }) => {
    const { db } = await import('/src/data/db.ts');
    const [resource, version, pending] = await Promise.all([
      db.resources.get(resourceId),
      db.resourceVersions.get(versionId),
      db.outbox.where('entityId').equals(resourceId).count(),
    ]);
    return {
      resourceState: resource?.syncState,
      versionState: version?.syncState,
      pending,
    };
  }, { resourceId: RESOURCE_ID, versionId: VERSION_ID })).toEqual({
    resourceState: 'synced',
    versionState: 'synced',
    pending: 0,
  });
});

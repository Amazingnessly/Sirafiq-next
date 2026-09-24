import { expect, test } from '@playwright/test';

const LOCAL_SUBJECT_ID = '21212121-2121-4121-8121-212121212121';
const LOCAL_RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const LOCAL_VERSION_ID = '23232323-2323-4323-8323-232323232323';
const REMOTE_RESOURCE_ID = '24242424-2424-4424-8424-242424242424';
const REMOTE_VERSION_ID = '25252525-2525-4525-8525-252525252525';
const REMOTE_SUBJECT_ID = '26262626-2626-4626-8626-262626262626';

test('un doublon distant encore uploading est achevé au lieu d’être déclaré réutilisable', async ({ page }) => {
  let blobUploads = 0;
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
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'DUPLICATE_SUPPORT',
            message: 'Ce fichier existe déjà dans la bibliothèque synchronisée.',
            retryable: false,
            details: { existingResourceId: REMOTE_RESOURCE_ID },
          },
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === `/api/resources/${REMOTE_RESOURCE_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subject: {
            id: REMOTE_SUBJECT_ID,
            name: 'Matière distante incomplète',
            parentId: null,
            createdAt: '2026-09-24T00:00:00.000Z',
            updatedAt: '2026-09-24T00:00:00.000Z',
          },
          resource: {
            id: REMOTE_RESOURCE_ID,
            subjectId: REMOTE_SUBJECT_ID,
            title: 'Doublon distant incomplet',
            kind: 'text',
            currentVersionId: REMOTE_VERSION_ID,
            createdAt: '2026-09-24T00:00:00.000Z',
            updatedAt: '2026-09-24T00:00:00.000Z',
          },
          version: {
            id: REMOTE_VERSION_ID,
            fileName: 'incomplet.txt',
            mimeType: 'text/plain',
            size: 29,
            sha256: 'a'.repeat(64),
            status: 'uploading',
            extractionStatus: 'pending',
            extractionError: null,
          },
          extraction: null,
        }),
      });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${REMOTE_VERSION_ID}/blob`) {
      blobUploads += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${REMOTE_VERSION_ID}/extraction`) {
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
    const text = 'Même contenu que le doublon.';
    const bytes = new TextEncoder().encode(text).buffer;

    await db.subjects.add({
      id: subjectId,
      name: 'Matière locale',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'Doublon local',
      kind: 'text',
      currentVersionId: versionId,
      status: 'ready',
      extractionError: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: versionId,
      resourceId,
      sha256: 'a'.repeat(64),
      fileName: 'doublon.txt',
      mimeType: 'text/plain',
      size: bytes.byteLength,
      bytes,
      createdAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.extractions.add({
      versionId,
      status: 'ready',
      pages: [{ pageNumber: 1, text }],
      charCount: text.length,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
    });
    await db.outbox.add({
      id: 'incomplete-duplicate-resource-sync',
      type: 'resource.sync',
      entityId: resourceId,
      attempts: 0,
      nextAttemptAt: Date.now(),
      lastError: null,
      createdAt: now,
    });
  }, {
    subjectId: LOCAL_SUBJECT_ID,
    resourceId: LOCAL_RESOURCE_ID,
    versionId: LOCAL_VERSION_ID,
  });

  await page.evaluate(async () => {
    const { requestSync } = await import('/src/lib/sync.ts');
    await requestSync();
  });

  expect(registrations).toBe(1);
  expect(blobUploads).toBe(1);
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
      remoteResourceId: resource?.remoteResourceId ?? null,
      remoteVersionId: version?.remoteVersionId ?? null,
      pending,
    };
  }, {
    resourceId: LOCAL_RESOURCE_ID,
    versionId: LOCAL_VERSION_ID,
  })).toEqual({
    resourceState: 'synced',
    versionState: 'synced',
    remoteResourceId: REMOTE_RESOURCE_ID,
    remoteVersionId: REMOTE_VERSION_ID,
    pending: 0,
  });
});

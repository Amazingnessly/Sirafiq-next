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
  let requiredSubjectSyncs = 0;
  let unrelatedSyncStarted = false;
  let releaseUnrelatedSync!: () => void;
  const unrelatedSyncGate = new Promise<void>((resolve) => {
    releaseUnrelatedSync = resolve;
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/subjects/upsert') {
      const body = request.postDataJSON() as { id?: string };
      if (body.id === '77777777-7777-4777-8777-777777777777') {
        unrelatedSyncStarted = true;
        await unrelatedSyncGate;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
      if (body.id === SUBJECT_ID) {
        requiredSubjectSyncs += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
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
    await db.subjects.bulkAdd([
      { id: '77777777-7777-4777-8777-777777777777', name: 'File réseau indépendante', parentId: null, createdAt: now, updatedAt: now, syncState: 'pending', syncError: null },
      { id: subjectId, name: 'Gros supports', parentId: null, createdAt: now, updatedAt: now, syncState: 'pending', syncError: null },
    ]);
    await db.outbox.bulkAdd([
      {
        id: 'e2e-unrelated-subject-sync',
        type: 'subject.upsert',
        entityId: '77777777-7777-4777-8777-777777777777',
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
        createdAt: new Date(Date.now() - 1000).toISOString(),
      },
      {
        id: 'e2e-required-subject-sync',
        type: 'subject.upsert',
        entityId: subjectId,
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
        createdAt: now,
      },
    ]);
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
  await expect.poll(() => unrelatedSyncStarted).toBe(true);

  try {
    await page.getByLabel('Fichier à reprendre').setInputFiles({ name: 'multipart.pdf', mimeType: 'application/pdf', buffer: fileBytes });
    await page.getByRole('button', { name: 'Reprendre l’envoi' }).click();

    await expect.poll(() => requiredSubjectSyncs, { timeout: 2_000 }).toBe(1);
    await expect.poll(() => uploadedParts.length, { timeout: 2_000 }).toBeGreaterThan(0);
  } finally {
    releaseUnrelatedSync();
  }

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


test('un échec réseau avant le démarrage rend le multipart explicitement reprenable', async ({ page }) => {
  const resourceId = '88888888-8888-4888-8888-888888888888';
  const versionId = '99999999-9999-4999-8999-999999999999';
  const subjectId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const networkMessage = 'Réseau indisponible avant le démarrage E2E';

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/resources/${resourceId}`) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NETWORK_E2E', message: networkMessage, retryable: true } }),
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
      name: 'Multipart réseau',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: rid,
      subjectId: sid,
      title: 'PDF à reprendre après réseau',
      kind: 'pdf',
      currentVersionId: vid,
      status: 'failed',
      extractionError: 'Extraction différée.',
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: vid,
      resourceId: rid,
      sha256: 'e2e-pre-upload-network-hash',
      fileName: 'reseau.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      bytes: null,
      createdAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.extractions.add({
      versionId: vid,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'LARGE_FILE_EXTRACTION_DEFERRED',
      errorMessage: 'Extraction différée.',
      createdAt: now,
    });
    await db.multipartUploads.add({
      versionId: vid,
      resourceId: rid,
      fileName: 'reseau.pdf',
      size: 1024,
      lastModified: 0,
      sha256: 'e2e-pre-upload-network-hash',
      uploadId: null,
      partSize: 8 * 1024 * 1024,
      parts: [],
      status: 'pending',
      error: null,
      updatedAt: now,
    });
  }, { resourceId, versionId, subjectId });

  const failure = await page.evaluate(async ({ rid }) => {
    const { uploadMultipartResourceWithRecovery } = await import('/src/lib/multipartRecovery.ts');
    const file = new File([new Uint8Array(1024)], 'reseau.pdf', { type: 'application/pdf' });
    try {
      await uploadMultipartResourceWithRecovery(rid, file);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, { rid: resourceId });

  expect(failure).toBe(networkMessage);
  await expect.poll(async () => page.evaluate(async ({ rid, vid }) => {
    const { db } = await import('/src/data/db.ts');
    const [resource, version, session] = await Promise.all([
      db.resources.get(rid),
      db.resourceVersions.get(vid),
      db.multipartUploads.get(vid),
    ]);
    return {
      resourceState: resource?.syncState,
      versionState: version?.syncState,
      sessionStatus: session?.status,
      sessionError: session?.error,
    };
  }, { rid: resourceId, vid: versionId })).toEqual({
    resourceState: 'error',
    versionState: 'error',
    sessionStatus: 'error',
    sessionError: networkMessage,
  });

  await page.goto(`/bibliotheque/${resourceId}`);
  await expect(page.getByText('L’envoi du gros fichier est interrompu.')).toBeVisible();
  await expect(page.getByLabel('Fichier à reprendre')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reprendre l’envoi' })).toBeVisible();
});

test('un échec de vérification initial ne laisse pas un multipart faussement actif', async ({ page }) => {
  const resourceId = 'abababab-abab-4bab-8bab-abababababab';
  const versionId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  const subjectId = 'efefefef-efef-4fef-8fef-efefefefefef';
  const size = 1024;
  const expectedBytes = Buffer.alloc(size, 1);
  const expectedSha = createHash('sha256').update(expectedBytes).digest('hex');
  let resourceReads = 0;
  let registrations = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/resources/${resourceId}`) {
      resourceReads += 1;
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Absent', retryable: false } }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      registrations += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, uploadMode: 'multipart' }) });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route E2E absente.', retryable: false } }),
    });
  });

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId: rid, versionId: vid, subjectId: sid, sha, size: fileSize }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    await db.subjects.add({
      id: sid,
      name: 'Multipart préflight',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: rid,
      subjectId: sid,
      title: 'Multipart avant réseau',
      kind: 'pdf',
      currentVersionId: vid,
      status: 'failed',
      extractionError: 'Extraction différée.',
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: vid,
      resourceId: rid,
      sha256: sha,
      fileName: 'pending.pdf',
      mimeType: 'application/pdf',
      size: fileSize,
      bytes: null,
      createdAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.extractions.add({
      versionId: vid,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'LARGE_FILE_EXTRACTION_DEFERRED',
      errorMessage: 'Extraction différée.',
      createdAt: now,
    });
    await db.multipartUploads.add({
      versionId: vid,
      resourceId: rid,
      fileName: 'pending.pdf',
      size: fileSize,
      lastModified: 0,
      sha256: sha,
      uploadId: null,
      partSize: 8 * 1024 * 1024,
      parts: [],
      status: 'pending',
      error: null,
      updatedAt: now,
    });
  }, { resourceId, versionId, subjectId, sha: expectedSha, size });

  const failure = await page.evaluate(async ({ rid, fileSize }) => {
    const { uploadMultipartResourceWithRecovery } = await import('/src/lib/multipartRecovery.ts');
    const wrongBytes = new Uint8Array(fileSize);
    wrongBytes.fill(2);
    const file = new File([wrongBytes], 'pending.pdf', { type: 'application/pdf' });
    try {
      await uploadMultipartResourceWithRecovery(rid, file);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, { rid: resourceId, fileSize: size });

  expect(failure).toBe('Le contenu du fichier sélectionné ne correspond pas au support à reprendre.');
  expect(resourceReads).toBe(0);
  expect(registrations).toBe(0);

  await expect.poll(async () => page.evaluate(async ({ rid, vid }) => {
    const { db } = await import('/src/data/db.ts');
    const [resource, version, session] = await Promise.all([
      db.resources.get(rid),
      db.resourceVersions.get(vid),
      db.multipartUploads.get(vid),
    ]);
    return {
      resourceState: resource?.syncState,
      versionState: version?.syncState,
      sessionStatus: session?.status,
      sessionError: session?.error,
    };
  }, { rid: resourceId, vid: versionId })).toEqual({
    resourceState: 'error',
    versionState: 'error',
    sessionStatus: 'error',
    sessionError: 'Le contenu du fichier sélectionné ne correspond pas au support à reprendre.',
  });
});


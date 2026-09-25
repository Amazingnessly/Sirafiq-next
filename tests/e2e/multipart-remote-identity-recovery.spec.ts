import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const MIB = 1024 * 1024;
const LOCAL_SUBJECT_ID = '81818181-1111-4111-8111-818181818181';
const LOCAL_RESOURCE_ID = '82828282-2222-4222-8222-828282828282';
const LOCAL_VERSION_ID = '83838383-3333-4333-8333-838383838383';
const REMOTE_RESOURCE_ID = '84848484-4444-4444-8444-848484848484';
const REMOTE_VERSION_ID = '85858585-5555-4555-8555-858585858585';
const REMOTE_SUBJECT_ID = '86868686-6666-4666-8666-868686868686';

test('une finalisation incertaine après déduplication se réconcilie avec les IDs distants', async ({ page }) => {
  const fileBytes = Buffer.alloc(11 * MIB, 9);
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');
  const uploadedParts: number[] = [];
  let completeCalls = 0;
  let remoteResourceReads = 0;
  let localIdentityCalls = 0;
  let extractionFailureCalls = 0;

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
      remoteResourceReads += 1;
      const stored = completeCalls > 0;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subject: {
            id: REMOTE_SUBJECT_ID,
            name: 'Matière distante',
            parentId: null,
            createdAt: '2026-09-25T00:00:00.000Z',
            updatedAt: '2026-09-25T00:00:00.000Z',
          },
          resource: {
            id: REMOTE_RESOURCE_ID,
            subjectId: REMOTE_SUBJECT_ID,
            title: 'Doublon multipart distant',
            kind: 'pdf',
            currentVersionId: REMOTE_VERSION_ID,
            createdAt: '2026-09-25T00:00:00.000Z',
            updatedAt: '2026-09-25T00:00:00.000Z',
          },
          version: {
            id: REMOTE_VERSION_ID,
            fileName: 'distant.pdf',
            mimeType: 'application/pdf',
            size: fileBytes.length,
            sha256,
            status: stored ? 'stored' : 'uploading',
            extractionStatus: 'pending',
            extractionError: null,
          },
          extraction: null,
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === `/api/resources/${LOCAL_RESOURCE_ID}`) {
      localIdentityCalls += 1;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'ID local absent du serveur.', retryable: false },
        }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${REMOTE_VERSION_ID}/multipart/create`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uploadId: 'remote-upload',
          partSize: 5 * MIB,
          parts: [],
        }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${LOCAL_VERSION_ID}/multipart/create`) {
      localIdentityCalls += 1;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'VERSION_NOT_FOUND', message: 'ID local absent du serveur.', retryable: false },
        }),
      });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${REMOTE_VERSION_ID}/multipart/part`) {
      const partNumber = Number(url.searchParams.get('partNumber'));
      uploadedParts.push(partNumber);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ partNumber, etag: `etag-${partNumber}` }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${REMOTE_VERSION_ID}/multipart/complete`) {
      completeCalls += 1;
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'MULTIPART_COMPLETE_FAILED',
            message: 'Réponse de finalisation perdue.',
            retryable: true,
          },
        }),
      });
      return;
    }

    if (
      request.method() === 'POST'
      && url.pathname === `/api/resource-versions/${REMOTE_VERSION_ID}/extraction-failure`
    ) {
      extractionFailureCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (
      request.method() === 'POST'
      && url.pathname.startsWith(`/api/resource-versions/${LOCAL_VERSION_ID}/`)
    ) {
      localIdentityCalls += 1;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'VERSION_NOT_FOUND', message: 'ID local absent du serveur.', retryable: false },
        }),
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
  await page.evaluate(async ({ subjectId, resourceId, versionId, hash, size }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();

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
      title: 'Doublon multipart local',
      kind: 'pdf',
      currentVersionId: versionId,
      status: 'failed',
      extractionError: 'Extraction différée.',
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: versionId,
      resourceId,
      sha256: hash,
      fileName: 'local.pdf',
      mimeType: 'application/pdf',
      size,
      bytes: null,
      createdAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.extractions.add({
      versionId,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'LARGE_FILE_EXTRACTION_DEFERRED',
      errorMessage: 'Extraction différée.',
      createdAt: now,
    });
    await db.multipartUploads.add({
      versionId,
      resourceId,
      fileName: 'local.pdf',
      size,
      lastModified: 0,
      sha256: hash,
      uploadId: null,
      partSize: 5 * 1024 * 1024,
      parts: [],
      status: 'pending',
      error: null,
      updatedAt: now,
    });
  }, {
    subjectId: LOCAL_SUBJECT_ID,
    resourceId: LOCAL_RESOURCE_ID,
    versionId: LOCAL_VERSION_ID,
    hash: sha256,
    size: fileBytes.length,
  });

  const failure = await page.evaluate(async ({ resourceId, bytes }) => {
    const { uploadMultipartResourceWithRecovery } = await import('/src/lib/multipartRecovery.ts');
    const file = new File([new Uint8Array(bytes)], 'local.pdf', {
      type: 'application/pdf',
      lastModified: 0,
    });
    try {
      await uploadMultipartResourceWithRecovery(resourceId, file, undefined, { identityAlreadyVerified: true });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, {
    resourceId: LOCAL_RESOURCE_ID,
    bytes: fileBytes,
  });

  expect(failure).toBeNull();
  expect(uploadedParts).toEqual([1, 2, 3]);
  expect(completeCalls).toBe(1);
  expect(remoteResourceReads).toBeGreaterThanOrEqual(2);
  expect(extractionFailureCalls).toBe(1);
  expect(localIdentityCalls).toBe(0);

  await expect.poll(async () => page.evaluate(async ({ resourceId, versionId }) => {
    const { db } = await import('/src/data/db.ts');
    const [resource, version, session] = await Promise.all([
      db.resources.get(resourceId),
      db.resourceVersions.get(versionId),
      db.multipartUploads.get(versionId),
    ]);
    return {
      resourceState: resource?.syncState,
      versionState: version?.syncState,
      remoteResourceId: resource?.remoteResourceId ?? null,
      remoteVersionId: version?.remoteVersionId ?? null,
      hasSession: Boolean(session),
    };
  }, {
    resourceId: LOCAL_RESOURCE_ID,
    versionId: LOCAL_VERSION_ID,
  })).toEqual({
    resourceState: 'synced',
    versionState: 'synced',
    remoteResourceId: REMOTE_RESOURCE_ID,
    remoteVersionId: REMOTE_VERSION_ID,
    hasSession: false,
  });
});

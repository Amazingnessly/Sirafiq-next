import { expect, test } from '@playwright/test';

const SUBJECT_ID = '91919191-1111-4111-8111-111111111111';
const LOCAL_RESOURCE_ID = '92929292-1111-4111-8111-111111111111';
const LOCAL_VERSION_ID = '93939393-1111-4111-8111-111111111111';
const STALE_RESOURCE_ID = '94949494-1111-4111-8111-111111111111';
const STALE_VERSION_ID = '95959595-1111-4111-8111-111111111111';
const SHA256 = 'a'.repeat(64);
const LOCAL_TEXT = 'Texte local utilisé pour recréer le stockage distant.';
const FIRST_EXTRACTION = 'Extraction serveur après réinscription sous les identifiants locaux.';
const SECOND_EXTRACTION = 'Extraction distante relue avec les identifiants locaux nettoyés.';

test('une réinscription sous les IDs locaux efface les anciens alias distants', async ({ page }) => {
  let staleLookups = 0;
  let localLookups = 0;
  let registrations = 0;
  const registrationBodies: unknown[] = [];
  const uploadPaths: string[] = [];
  const extractionPaths: string[] = [];

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

    if (request.method() === 'GET' && url.pathname === `/api/resources/${STALE_RESOURCE_ID}`) {
      staleLookups += 1;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'Ancien alias distant supprimé.',
            retryable: false,
          },
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === `/api/resources/${LOCAL_RESOURCE_ID}`) {
      localLookups += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subject: {
            id: SUBJECT_ID,
            name: 'Alias nettoyés',
            parentId: null,
            createdAt: '2026-09-28T00:00:00.000Z',
            updatedAt: '2026-09-28T00:00:00.000Z',
          },
          resource: {
            id: LOCAL_RESOURCE_ID,
            subjectId: SUBJECT_ID,
            title: 'Support avec ancien alias',
            kind: 'text',
            currentVersionId: LOCAL_VERSION_ID,
            createdAt: '2026-09-28T00:00:00.000Z',
            updatedAt: '2026-09-28T00:00:00.000Z',
          },
          version: {
            id: LOCAL_VERSION_ID,
            fileName: 'alias.txt',
            mimeType: 'text/plain',
            size: new TextEncoder().encode(LOCAL_TEXT).byteLength,
            sha256: SHA256,
            status: 'ready',
            extractionStatus: 'ready',
            extractionError: null,
          },
          extraction: {
            pages: [{ pageNumber: 1, text: SECOND_EXTRACTION }],
            charCount: SECOND_EXTRACTION.length,
          },
        }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      registrations += 1;
      registrationBodies.push(JSON.parse(request.postData() ?? '{}'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          uploadMode: 'single',
          alreadyStored: false,
        }),
      });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${LOCAL_VERSION_ID}/blob`) {
      uploadPaths.push(url.pathname);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${LOCAL_VERSION_ID}/server-extraction`) {
      extractionPaths.push(url.pathname);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          pages: [{ pageNumber: 1, text: FIRST_EXTRACTION }],
          charCount: FIRST_EXTRACTION.length,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'UNEXPECTED_ALIAS_TEST_ROUTE',
          message: `Route inattendue: ${request.method()} ${url.pathname}`,
          retryable: false,
        },
      }),
    });
  });

  await page.goto('/bibliotheque');

  await page.evaluate(async ({ subjectId, resourceId, versionId, staleResourceId, staleVersionId, sha256, text }) => {
    const { db } = await import('/src/data/db.ts');
    const now = '2026-09-28T00:00:00.000Z';
    const bytes = new TextEncoder().encode(text).buffer;

    await db.subjects.add({
      id: subjectId,
      name: 'Alias nettoyés',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'Support avec ancien alias',
      kind: 'text',
      currentVersionId: versionId,
      remoteResourceId: staleResourceId,
      status: 'failed',
      extractionError: 'Extraction à reprendre.',
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: versionId,
      resourceId,
      sha256,
      fileName: 'alias.txt',
      mimeType: 'text/plain',
      size: bytes.byteLength,
      bytes,
      remoteVersionId: staleVersionId,
      createdAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.extractions.add({
      versionId,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'LOCAL_EXTRACTION_FAILED',
      errorMessage: 'Extraction à reprendre.',
      createdAt: now,
    });
  }, {
    subjectId: SUBJECT_ID,
    resourceId: LOCAL_RESOURCE_ID,
    versionId: LOCAL_VERSION_ID,
    staleResourceId: STALE_RESOURCE_ID,
    staleVersionId: STALE_VERSION_ID,
    sha256: SHA256,
    text: LOCAL_TEXT,
  });

  await page.evaluate(async (resourceId) => {
    const { retryServerExtractionForResource } = await import('/src/lib/sync.ts');
    await retryServerExtractionForResource(resourceId);
  }, LOCAL_RESOURCE_ID);

  expect(staleLookups).toBe(1);
  expect(localLookups).toBe(0);
  expect(registrations).toBe(1);
  expect(uploadPaths).toEqual([`/api/resource-versions/${LOCAL_VERSION_ID}/blob`]);
  expect(extractionPaths).toEqual([`/api/resource-versions/${LOCAL_VERSION_ID}/server-extraction`]);
  expect(registrationBodies).toHaveLength(1);
  expect(registrationBodies[0]).toMatchObject({
    resource: { id: LOCAL_RESOURCE_ID, currentVersionId: LOCAL_VERSION_ID },
    version: { id: LOCAL_VERSION_ID, resourceId: LOCAL_RESOURCE_ID },
  });

  const aliases = await page.evaluate(async ({ resourceId, versionId }) => {
    const { db } = await import('/src/data/db.ts');
    const [resource, version] = await Promise.all([
      db.resources.get(resourceId),
      db.resourceVersions.get(versionId),
    ]);
    return {
      hasRemoteResourceId: Boolean(resource && Object.prototype.hasOwnProperty.call(resource, 'remoteResourceId')),
      remoteResourceId: resource?.remoteResourceId ?? null,
      hasRemoteVersionId: Boolean(version && Object.prototype.hasOwnProperty.call(version, 'remoteVersionId')),
      remoteVersionId: version?.remoteVersionId ?? null,
    };
  }, { resourceId: LOCAL_RESOURCE_ID, versionId: LOCAL_VERSION_ID });

  expect(aliases).toEqual({
    hasRemoteResourceId: false,
    remoteResourceId: null,
    hasRemoteVersionId: false,
    remoteVersionId: null,
  });

  await page.evaluate(async ({ resourceId, versionId }) => {
    const { db } = await import('/src/data/db.ts');
    await db.resources.update(resourceId, {
      status: 'failed',
      extractionError: 'Deuxième vérification distante.',
    });
    await db.extractions.update(versionId, {
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'SECOND_RETRY',
      errorMessage: 'Deuxième vérification distante.',
    });
  }, { resourceId: LOCAL_RESOURCE_ID, versionId: LOCAL_VERSION_ID });

  await page.evaluate(async (resourceId) => {
    const { retryServerExtractionForResource } = await import('/src/lib/sync.ts');
    await retryServerExtractionForResource(resourceId);
  }, LOCAL_RESOURCE_ID);

  expect(staleLookups).toBe(1);
  expect(localLookups).toBe(1);
  expect(registrations).toBe(1);
  expect(uploadPaths).toHaveLength(1);
  expect(extractionPaths).toHaveLength(1);

  await expect.poll(async () => page.evaluate(async (versionId) => {
    const { db } = await import('/src/data/db.ts');
    return (await db.extractions.get(versionId))?.pages[0]?.text ?? null;
  }, LOCAL_VERSION_ID)).toBe(SECOND_EXTRACTION);
});

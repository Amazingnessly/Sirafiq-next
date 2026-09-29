import { expect, test } from '@playwright/test';
import { LOCAL_PDF_EXTRACTION_MAX_BYTES } from '../../src/shared/importPolicy';

test('un fichier au-dessus de 25 MiB est persisté sans attendre le réseau ni être relu intégralement', async ({ page }) => {
  const subjectId = '25252525-2525-4252-8252-252525252525';
  const networkMessage = 'Arrêt réseau E2E après persistance locale';
  let registrationStarted = false;
  let releaseRegistration!: () => void;
  const registrationGate = new Promise<void>((resolve) => {
    releaseRegistration = resolve;
  });

  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [], resources: [] }),
    });
  });
  await page.route('**/api/resources/register', async (route) => {
    registrationStarted = true;
    await registrationGate;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'LARGE_FILE_E2E_STOP',
          message: networkMessage,
          retryable: true,
        },
      }),
    });
  });

  await page.goto('/bibliotheque');

  const result = await page.evaluate(async ({ subjectId: sid, size, expectedMessage }) => {
    const { db } = await import('/src/data/db.ts');
    const { importFile } = await import('/src/data/repository.ts');
    const now = new Date().toISOString();

    await db.subjects.put({
      id: sid,
      name: 'Gros fichier mémoire',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });

    const smallChunk = new Uint8Array(1024);
    const fakeLargeFile = {
      name: 'memoire.pdf',
      type: 'application/pdf',
      size,
      lastModified: 123,
      slice(_start?: number, _end?: number, contentType?: string) {
        return new Blob([smallChunk], { type: contentType || 'application/pdf' });
      },
      async arrayBuffer() {
        throw new Error('FULL_FILE_ARRAY_BUFFER_FORBIDDEN');
      },
    } as unknown as File;

    const imported = await importFile(sid, fakeLargeFile, 'PDF mémoire iPad');
    const resource = await db.resources.get(imported.id);
    if (!resource) throw new Error('Le support volumineux n’a pas été persisté');
    const [version, session] = await Promise.all([
      db.resourceVersions.get(resource.currentVersionId),
      db.multipartUploads.get(resource.currentVersionId),
    ]);
    if (!version || !session) throw new Error('Le parcours multipart n’a pas été créé');

    return {
      resourceId: resource.id,
      expectedMessage,
      bytesAreNull: version.bytes === null,
      storedSize: version.size,
    };
  }, {
    subjectId,
    size: LOCAL_PDF_EXTRACTION_MAX_BYTES + 1,
    expectedMessage: networkMessage,
  });

  expect(result.bytesAreNull).toBe(true);
  expect(result.storedSize).toBe(LOCAL_PDF_EXTRACTION_MAX_BYTES + 1);

  try {
    await expect.poll(() => registrationStarted).toBe(true);
  } finally {
    releaseRegistration();
  }

  await expect.poll(async () => page.evaluate(async ({ resourceId, expectedMessage }) => {
    const { db } = await import('/src/data/db.ts');
    const resource = await db.resources.get(resourceId);
    if (!resource) return null;
    const [version, session] = await Promise.all([
      db.resourceVersions.get(resource.currentVersionId),
      db.multipartUploads.get(resource.currentVersionId),
    ]);
    return {
      resourceState: resource.syncState,
      resourceError: resource.syncError,
      versionState: version?.syncState,
      sessionStatus: session?.status,
      sessionError: session?.error,
      expectedMessage,
    };
  }, { resourceId: result.resourceId, expectedMessage: result.expectedMessage })).toEqual({
    resourceState: 'error',
    resourceError: result.expectedMessage,
    versionState: 'error',
    sessionStatus: 'error',
    sessionError: result.expectedMessage,
    expectedMessage: result.expectedMessage,
  });
});

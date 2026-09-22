import { expect, test } from '@playwright/test';
import { LOCAL_PDF_EXTRACTION_MAX_BYTES } from '../../src/shared/importPolicy';

test('un fichier au-dessus de 25 MiB n’est jamais relu intégralement pour IndexedDB', async ({ page }) => {
  const subjectId = '25252525-2525-4252-8252-252525252525';
  const networkMessage = 'Arrêt réseau E2E après persistance locale';

  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [], resources: [] }),
    });
  });
  await page.route('**/api/resources/*', async (route) => {
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

    let errorMessage: string | null = null;
    try {
      await importFile(sid, fakeLargeFile, 'PDF mémoire iPad');
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    const resource = (await db.resources.toArray()).find((item) => item.title === 'PDF mémoire iPad');
    if (!resource) throw new Error('Le support volumineux n’a pas été persisté');
    const [version, session] = await Promise.all([
      db.resourceVersions.get(resource.currentVersionId),
      db.multipartUploads.get(resource.currentVersionId),
    ]);
    if (!version || !session) throw new Error('Le parcours multipart n’a pas été créé');

    return {
      errorMessage,
      expectedMessage,
      bytesAreNull: version.bytes === null,
      storedSize: version.size,
      sessionStatus: session.status,
      resourceState: resource.syncState,
    };
  }, {
    subjectId,
    size: LOCAL_PDF_EXTRACTION_MAX_BYTES + 1,
    expectedMessage: networkMessage,
  });

  expect(result.errorMessage).toBe(result.expectedMessage);
  expect(result.bytesAreNull).toBe(true);
  expect(result.storedSize).toBe(LOCAL_PDF_EXTRACTION_MAX_BYTES + 1);
  expect(result.sessionStatus).toBe('error');
  expect(result.resourceState).toBe('error');
});

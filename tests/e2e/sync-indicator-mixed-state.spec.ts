import { expect, test } from '@playwright/test';

test('le travail en attente reste synchronisable à côté d’une erreur bloquée', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.evaluate(async () => {
    const { db } = await import('/src/data/db.ts');
    await db.open();
    const now = new Date().toISOString();
    await db.transaction('rw', db.subjects, db.outbox, async () => {
      await db.outbox.clear();
      await db.subjects.bulkPut([
        {
          id: 'e2e-blocked-subject-record',
          name: 'Matière bloquée',
          parentId: null,
          createdAt: now,
          updatedAt: now,
          syncState: 'error',
          syncError: 'Erreur terminale E2E',
        },
        {
          id: 'e2e-pending-subject-record',
          name: 'Matière en attente',
          parentId: null,
          createdAt: now,
          updatedAt: now,
          syncState: 'pending',
          syncError: null,
        },
      ]);
      await db.outbox.bulkAdd([
        {
          id: 'e2e-blocked-subject',
          type: 'subject.upsert',
          entityId: 'e2e-blocked-subject-record',
          attempts: 5,
          lastError: 'Erreur terminale E2E',
          nextAttemptAt: Number.MAX_SAFE_INTEGER,
          createdAt: now,
        },
        {
          id: 'e2e-pending-subject',
          type: 'subject.upsert',
          entityId: 'e2e-pending-subject-record',
          attempts: 0,
          lastError: null,
          nextAttemptAt: Date.now() + 60_000,
          createdAt: now,
        },
      ]);
    });
  });

  await page.reload();
  await expect(page.getByRole('button', { name: /1 en attente · Synchroniser · 1 bloquée/ })).toBeVisible();
});

test('un multipart interrompu ne gonfle pas le compteur de travail synchronisable', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.evaluate(async () => {
    const { db } = await import('/src/data/db.ts');
    await db.open();
    const resourceId = 'e2e-multipart-resource';
    const versionId = 'e2e-multipart-version';
    const now = new Date().toISOString();

    await db.transaction('rw', db.resources, db.outbox, db.multipartUploads, async () => {
      await db.resources.put({
        id: resourceId,
        subjectId: 'e2e-multipart-subject',
        title: 'PDF multipart interrompu',
        kind: 'pdf',
        currentVersionId: versionId,
        status: 'ready',
        extractionError: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'error',
        syncError: 'Envoi interrompu E2E',
      });
      await db.outbox.put({
        id: 'e2e-multipart-outbox',
        type: 'resource.sync',
        entityId: resourceId,
        attempts: 1,
        lastError: 'Envoi interrompu E2E',
        nextAttemptAt: Date.now() + 60_000,
        createdAt: now,
      });
      await db.multipartUploads.put({
        versionId,
        resourceId,
        fileName: 'interrompu.pdf',
        size: 100 * 1024 * 1024,
        lastModified: Date.now(),
        sha256: 'e2e-multipart-sha',
        uploadId: 'e2e-upload',
        partSize: 8 * 1024 * 1024,
        parts: [],
        status: 'error',
        error: 'Envoi interrompu E2E',
        updatedAt: now,
      });
    });
  });

  await page.reload();

  await expect(page.getByRole('link', { name: /1 envoi à reprendre · Resélectionner/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /en attente · Synchroniser/ })).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect.poll(async () => page.evaluate(async () => {
    const { db } = await import('/src/data/db.ts');
    return db.outbox.where('entityId').equals('e2e-multipart-resource').and((item) => item.type === 'resource.sync').count();
  })).toBe(0);
  await expect.poll(async () => page.evaluate(async () => {
    const { db } = await import('/src/data/db.ts');
    const [resource, multipart] = await Promise.all([
      db.resources.get('e2e-multipart-resource'),
      db.multipartUploads.get('e2e-multipart-version'),
    ]);
    return {
      syncState: resource?.syncState,
      syncError: resource?.syncError,
      multipartStatus: multipart?.status,
    };
  })).toEqual({
    syncState: 'error',
    syncError: 'Envoi interrompu E2E',
    multipartStatus: 'error',
  });
  await expect(page.getByRole('link', { name: /1 envoi à reprendre · Resélectionner/ })).toBeVisible();
});



test('un multipart actif ne prétend pas que tout est enregistré', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.evaluate(async () => {
    const { db } = await import('/src/data/db.ts');
    await db.open();
    const now = new Date().toISOString();
    await db.multipartUploads.put({
      versionId: 'e2e-active-multipart-version',
      resourceId: 'e2e-active-multipart-resource',
      fileName: 'en-cours.pdf',
      size: 100 * 1024 * 1024,
      lastModified: Date.now(),
      sha256: 'e2e-active-multipart-sha',
      uploadId: 'e2e-active-upload',
      partSize: 8 * 1024 * 1024,
      parts: [],
      status: 'uploading',
      error: null,
      updatedAt: now,
    });
  });

  await expect(page.getByText('1 envoi en cours', { exact: true })).toBeVisible();
  await expect(page.getByText('Enregistré', { exact: true })).toHaveCount(0);
});


test('un multipart persisté comme actif devient reprenable après rechargement', async ({ page }) => {
  const resourceId = 'e2e-reloaded-multipart-resource';
  const versionId = 'e2e-reloaded-multipart-version';

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId: rid, versionId: vid }) => {
    const { db } = await import('/src/data/db.ts');
    await db.open();
    const now = new Date().toISOString();
    await db.resources.put({
      id: rid,
      subjectId: 'e2e-reloaded-multipart-subject',
      title: 'PDF interrompu par reload',
      kind: 'pdf',
      currentVersionId: vid,
      status: 'failed',
      extractionError: 'Extraction différée.',
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.resourceVersions.put({
      id: vid,
      resourceId: rid,
      sha256: 'e2e-reloaded-multipart-sha',
      fileName: 'reload.pdf',
      mimeType: 'application/pdf',
      size: 100 * 1024 * 1024,
      bytes: null,
      createdAt: now,
      syncState: 'pending',
      syncError: null,
    });
    await db.extractions.put({
      versionId: vid,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'LARGE_FILE_EXTRACTION_DEFERRED',
      errorMessage: 'Extraction différée.',
      createdAt: now,
    });
    await db.multipartUploads.put({
      versionId: vid,
      resourceId: rid,
      fileName: 'reload.pdf',
      size: 100 * 1024 * 1024,
      lastModified: Date.now(),
      sha256: 'e2e-reloaded-multipart-sha',
      uploadId: 'e2e-reloaded-upload',
      partSize: 8 * 1024 * 1024,
      parts: [{ partNumber: 1, etag: 'etag-1' }],
      status: 'uploading',
      error: null,
      updatedAt: now,
    });
  }, { resourceId, versionId });

  await expect(page.getByText('1 envoi en cours', { exact: true })).toBeVisible();
  await page.reload();

  await expect(page.getByRole('link', { name: /1 envoi à reprendre · Resélectionner/ })).toBeVisible();
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
    };
  }, { rid: resourceId, vid: versionId })).toEqual({
    resourceState: 'error',
    versionState: 'error',
    sessionStatus: 'error',
  });

  await page.goto(`/bibliotheque/${resourceId}`);
  await expect(page.getByText('L’envoi du gros fichier est interrompu.')).toBeVisible();
  await expect(page.getByLabel('Fichier à reprendre')).toBeVisible();
});


test('un support garé derrière une matière bloquée ne crée pas un bouton Synchroniser sans effet', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.evaluate(async () => {
    const { db } = await import('/src/data/db.ts');
    await db.open();
    const now = new Date().toISOString();
    const subjectId = 'e2e-blocked-dependency-subject';
    const resourceId = 'e2e-blocked-dependency-resource';
    const versionId = 'e2e-blocked-dependency-version';

    await db.transaction('rw', db.subjects, db.resources, db.resourceVersions, db.outbox, async () => {
      await db.outbox.clear();
      await db.subjects.put({
        id: subjectId,
        name: 'Matière bloquée avec support',
        parentId: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'error',
        syncError: 'Erreur terminale E2E',
      });
      await db.resources.put({
        id: resourceId,
        subjectId,
        title: 'Support dépendant valide',
        kind: 'text',
        currentVersionId: versionId,
        status: 'ready',
        extractionError: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.resourceVersions.put({
        id: versionId,
        resourceId,
        sha256: 'b'.repeat(64),
        fileName: 'dependant.txt',
        mimeType: 'text/plain',
        size: 8,
        bytes: new TextEncoder().encode('dependant').buffer,
        createdAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.outbox.bulkPut([
        {
          id: 'e2e-blocked-dependency-subject-work',
          type: 'subject.upsert',
          entityId: subjectId,
          attempts: 5,
          lastError: 'Erreur terminale E2E',
          nextAttemptAt: Number.MAX_SAFE_INTEGER,
          createdAt: now,
        },
        {
          id: 'e2e-blocked-dependency-resource-work',
          type: 'resource.sync',
          entityId: resourceId,
          attempts: 0,
          lastError: 'Erreur terminale E2E',
          nextAttemptAt: Number.MAX_SAFE_INTEGER,
          createdAt: now,
        },
      ]);
    });
  });

  await page.reload();

  await expect(page.getByRole('link', { name: /1 erreur bloquée · Vérifier/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /en attente · Synchroniser/ })).toHaveCount(0);
});

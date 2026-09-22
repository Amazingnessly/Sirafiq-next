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


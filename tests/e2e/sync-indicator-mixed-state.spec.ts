import { expect, test } from '@playwright/test';

test('le travail en attente reste synchronisable à côté d’une erreur bloquée', async ({ page }) => {
  await page.goto('/bibliotheque');

  for (const name of ['Matière bloquée', 'Matière en attente']) {
    await page.getByLabel('Nouvelle matière', { exact: true }).first().fill(name);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sirafiq-next');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['subjects', 'outbox'], 'readwrite');
      const subjects = transaction.objectStore('subjects');
      const outbox = transaction.objectStore('outbox');
      const request = subjects.openCursor();
      let blockedId = '';
      let pendingId = '';

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          if (!blockedId || !pendingId) {
            transaction.abort();
            return;
          }

          outbox.clear();
          const createdAt = new Date().toISOString();
          outbox.put({
            id: 'e2e-blocked-subject',
            type: 'subject.upsert',
            entityId: blockedId,
            attempts: 5,
            lastError: 'Erreur terminale E2E',
            nextAttemptAt: Number.MAX_SAFE_INTEGER,
            createdAt,
          });
          outbox.put({
            id: 'e2e-pending-subject',
            type: 'subject.upsert',
            entityId: pendingId,
            attempts: 0,
            lastError: null,
            // Keep this entry pending long enough to inspect the mixed UI state.
            // A due entry (0) can be consumed by the automatic sync immediately
            // after reload, making this E2E scenario race the sync worker.
            nextAttemptAt: Date.now() + 60_000,
            createdAt,
          });
          return;
        }

        if (cursor.value.name === 'Matière bloquée') {
          blockedId = cursor.value.id as string;
          cursor.update({ ...cursor.value, syncState: 'error', syncError: 'Erreur terminale E2E' });
        } else if (cursor.value.name === 'Matière en attente') {
          pendingId = cursor.value.id as string;
          cursor.update({ ...cursor.value, syncState: 'pending', syncError: null });
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Transaction E2E annulée'));
    });
    database.close();
  });

  await page.reload();
  await expect(page.getByRole('button', { name: /1 en attente · Synchroniser · 1 bloquée/ })).toBeVisible();
});

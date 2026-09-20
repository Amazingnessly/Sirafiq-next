import { expect, test } from '@playwright/test';

test('le travail en attente reste synchronisable à côté d’une erreur bloquée', async ({ page }) => {
  await page.goto('/bibliotheque');

  for (const name of ['Matière bloquée', 'Matière en attente']) {
    await page.getByLabel('Nouvelle matière', { exact: true }).first().fill(name);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
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
      const subjectRequest = subjects.openCursor();
      let blockedId = '';

      subjectRequest.onsuccess = () => {
        const cursor = subjectRequest.result;
        if (!cursor) return;
        if (cursor.value.name === 'Matière bloquée') {
          blockedId = cursor.value.id as string;
          cursor.update({ ...cursor.value, syncState: 'error', syncError: 'Erreur terminale E2E' });
        }
        cursor.continue();
      };

      const outboxRequest = outbox.openCursor();
      outboxRequest.onsuccess = () => {
        const cursor = outboxRequest.result;
        if (!cursor) return;
        if (blockedId && cursor.value.type === 'subject.upsert' && cursor.value.entityId === blockedId) {
          cursor.update({
            ...cursor.value,
            attempts: 5,
            lastError: 'Erreur terminale E2E',
            nextAttemptAt: Number.MAX_SAFE_INTEGER,
          });
        }
        cursor.continue();
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Transaction E2E annulée'));
    });
    database.close();
  });

  await page.reload();
  await expect(page.getByRole('button', { name: /1 en attente · Synchroniser · 1 bloquée/ })).toBeVisible();
});

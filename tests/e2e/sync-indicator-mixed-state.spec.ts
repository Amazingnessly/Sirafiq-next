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

    const blockedId = await new Promise<string>((resolve, reject) => {
      const transaction = database.transaction('subjects', 'readwrite');
      const request = transaction.objectStore('subjects').openCursor();
      let id = '';
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value.name === 'Matière bloquée') {
          id = cursor.value.id as string;
          cursor.update({ ...cursor.value, syncState: 'error', syncError: 'Erreur terminale E2E' });
          return;
        }
        cursor.continue();
      };
      transaction.oncomplete = () => id ? resolve(id) : reject(new Error('Matière bloquée introuvable'));
      transaction.onerror = () => reject(transaction.error);
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('outbox', 'readwrite');
      const request = transaction.objectStore('outbox').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value.type === 'subject.upsert' && cursor.value.entityId === blockedId) {
          cursor.update({
            ...cursor.value,
            attempts: 5,
            lastError: 'Erreur terminale E2E',
            nextAttemptAt: Number.MAX_SAFE_INTEGER,
          });
          return;
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await expect(page.getByRole('button', { name: /1 en attente · Synchroniser · 1 bloquée/ })).toBeVisible();
});

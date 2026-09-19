import { expect, test } from '@playwright/test';

test('une matière en erreur reconstruit son travail de synchronisation manquant', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Matière à reprendre');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Matière à reprendre', { exact: true })).toBeVisible();

  const subjectId = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sirafiq-next');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const id = await new Promise<string>((resolve, reject) => {
      const transaction = database.transaction(['subjects', 'outbox'], 'readwrite');
      const subjects = transaction.objectStore('subjects');
      const outbox = transaction.objectStore('outbox');
      const request = subjects.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return reject(new Error('Matière E2E introuvable'));
        const subject = cursor.value;
        cursor.update({ ...subject, syncState: 'error', syncError: 'Échec réseau E2E' });
        const outboxRequest = outbox.openCursor();
        outboxRequest.onsuccess = () => {
          const outboxCursor = outboxRequest.result;
          if (!outboxCursor) return;
          if (outboxCursor.value.type === 'subject.upsert' && outboxCursor.value.entityId === subject.id) {
            outboxCursor.delete();
          } else {
            outboxCursor.continue();
          }
        };
        resolve(subject.id as string);
      };
      request.onerror = () => reject(request.error);
    });
    database.close();
    return id;
  });

  let retryRequests = 0;
  await page.route('**/api/subjects/upsert', async (route) => {
    retryRequests += 1;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'E2E_RETRY', message: 'Échec réseau E2E', retryable: true } }),
    });
  });

  await page.reload();
  await expect(page.getByText('Échec réseau E2E', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Réessayer la synchronisation' }).click();
  await expect.poll(() => retryRequests).toBe(1);

  const recovery = await page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sirafiq-next');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise<{ attempts: number; lastError: string | null; syncState: string }>((resolve, reject) => {
      const transaction = database.transaction(['subjects', 'outbox'], 'readonly');
      const subjectRequest = transaction.objectStore('subjects').get(id);
      const outboxRequest = transaction.objectStore('outbox').openCursor();
      let subjectState = '';
      let matching: { attempts: number; lastError: string | null } | null = null;
      subjectRequest.onsuccess = () => {
        subjectState = subjectRequest.result?.syncState ?? '';
      };
      outboxRequest.onsuccess = () => {
        const cursor = outboxRequest.result;
        if (cursor) {
          if (cursor.value.type === 'subject.upsert' && cursor.value.entityId === id) {
            matching = { attempts: cursor.value.attempts, lastError: cursor.value.lastError };
          }
          cursor.continue();
        }
      };
      transaction.oncomplete = () => {
        if (!matching) return reject(new Error('Le travail de reprise n’a pas été reconstruit'));
        resolve({ ...matching, syncState: subjectState });
      };
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return result;
  }, subjectId);

  expect(recovery.attempts).toBe(1);
  expect(recovery.lastError).toContain('Échec réseau E2E');
  expect(recovery.syncState).toBe('error');
});

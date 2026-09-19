import { expect, test } from '@playwright/test';

test('le filtre de synchronisation isole un support à reprendre', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Sync E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByLabel(/Titre/).fill('Support à reprendre');
  await page.getByLabel('Contenu').fill('Contenu destiné au filtre de récupération de synchronisation.');
  await page.getByRole('button', { name: 'Importer le support' }).click();
  await expect(page.getByRole('heading', { name: 'Support à reprendre' })).toBeVisible();

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sirafiq-next');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('resources', 'readwrite');
      const store = transaction.objectStore('resources');
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.update({ ...cursor.value, syncState: 'error', syncError: 'Échec E2E' });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.goto('/bibliotheque?status=sync-error');
  await expect(page.getByRole('button', { name: 'À synchroniser' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Support à reprendre' })).toBeVisible();
  const currentSyncError = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sirafiq-next');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const syncError = await new Promise<string | null>((resolve, reject) => {
      const transaction = database.transaction('resources', 'readonly');
      const request = transaction.objectStore('resources').openCursor();
      request.onsuccess = () => resolve((request.result?.value.syncError as string | null | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return syncError;
  });
  expect(currentSyncError).toBeTruthy();
  await expect(page.getByText(/Synchronisation à reprendre/)).toBeVisible();
  await expect(page.getByText(currentSyncError!, { exact: false })).toBeVisible();
  await expect(page.getByText(/Ouvrez le support pour réessayer/)).toBeVisible();

  await page.getByRole('link', { name: /Support à reprendre/ }).click();
  await expect(page.getByRole('button', { name: 'Retenter la synchronisation' })).toBeVisible();

  await page.goto('/bibliotheque?status=sync-error');
  await page.getByRole('button', { name: 'Extraits' }).click();
  await expect(page).toHaveURL(/status=ready/);
});

import { expect, test } from '@playwright/test';

test('Sirāfiq démarre sans APIs modernes requises par certains moteurs PDF', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Promise, 'withResolvers', { value: undefined, configurable: true });
    Object.defineProperty(Promise, 'try', { value: undefined, configurable: true });
    Object.defineProperty(Array.prototype, 'at', { value: undefined, configurable: true });
  });

  await page.goto('/bibliotheque');

  await expect(page.getByRole('heading', { name: 'Vos supports, sans ambiguïté.' })).toBeVisible();
  await expect(page.getByText('Sirāfiq n’a pas pu démarrer')).toHaveCount(0);
});

test('le mode hors ligne garde visible le travail en attente de synchronisation', async ({ page, context }) => {
  await page.goto('/bibliotheque');
  await context.setOffline(true);
  // Playwright WebKit blocks the network but does not consistently emit the browser
  // connectivity event that Safari dispatches when navigator.onLine changes.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const offlineStatus = page.getByRole('status').filter({ hasText: 'Hors ligne' });
  await expect(offlineStatus).toBeVisible();

  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Hors ligne E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  await expect(offlineStatus).toContainText('1 en attente');
});

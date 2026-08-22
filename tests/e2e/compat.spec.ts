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

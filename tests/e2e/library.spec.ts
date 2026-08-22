import { expect, test } from '@playwright/test';

test('matière → texte réel → persistance après rechargement', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.getByLabel('Nouvelle matière').fill('Français E2E');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByRole('listitem').getByText('Français E2E', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByLabel(/Titre/).fill('Lecture test');
  await page.getByLabel('Contenu').fill('Sirāfiq conserve ce texte réel puis le restitue après rechargement.');
  await page.getByRole('button', { name: 'Importer le support' }).click();

  await expect(page.getByRole('heading', { name: 'Lecture test' })).toBeVisible();
  await page.getByRole('heading', { name: 'Lecture test' }).click();
  await expect(page.getByText('Sirāfiq conserve ce texte réel puis le restitue après rechargement.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Sirāfiq conserve ce texte réel puis le restitue après rechargement.')).toBeVisible();
});

test('depuis une bibliothèque vide, la matière peut être créée dans le bloc import', async ({ page }) => {
  await page.goto('/bibliotheque');

  const importSubject = page.getByLabel('Nouvelle matière', { exact: true }).last();
  await expect(page.getByText('Commencez par une matière')).toBeVisible();
  await importSubject.fill('Onboarding E2E');
  await page.getByRole('button', { name: 'Créer et continuer' }).click();

  await expect(page.getByRole('button', { name: 'Texte', exact: true })).toBeVisible();
  await expect(page.getByLabel('Matière')).toHaveValue(/.+/);
  await expect(page.getByLabel('Matière').getByRole('option', { name: 'Onboarding E2E' })).toBeAttached();
});

test('un même contenu n’est pas importé deux fois localement', async ({ page }) => {
  await page.goto('/bibliotheque');

  const subjectInput = page.getByLabel('Nouvelle matière');
  if (await subjectInput.isVisible()) {
    await subjectInput.fill('Doublons E2E');
    await page.getByRole('button', { name: 'Ajouter' }).click();
    await expect(page.getByRole('listitem').getByText('Doublons E2E', { exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByLabel(/Titre/).fill('Même contenu A');
  await page.getByLabel('Contenu').fill('Contenu identique pour vérifier le hash anti-doublon.');
  await page.getByRole('button', { name: 'Importer le support' }).click();
  await expect(page.getByRole('heading', { name: 'Même contenu A' })).toBeVisible();

  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByLabel(/Titre/).fill('Même contenu B');
  await page.getByLabel('Contenu').fill('Contenu identique pour vérifier le hash anti-doublon.');
  await page.getByRole('button', { name: 'Importer le support' }).click();

  await expect(page.getByText('Ce fichier existe déjà dans la bibliothèque.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir le support existant' })).toBeVisible();
});

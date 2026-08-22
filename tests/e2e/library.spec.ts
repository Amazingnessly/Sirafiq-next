import { expect, test } from '@playwright/test';

test('matière → texte réel → persistance après rechargement', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Français E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('listitem').getByText('Français E2E', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByLabel(/Titre/).fill('Lecture test');
  await page.getByLabel('Contenu').fill('Sirāfiq conserve ce texte réel puis le restitue après rechargement.');
  await expect(page.getByRole('button', { name: 'Importer le support' })).toBeEnabled();
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

  const subjectSelect = page.getByRole('combobox', { name: 'Matière du support' });
  await expect(page.getByRole('button', { name: 'Texte', exact: true })).toBeVisible();
  await expect(subjectSelect).toHaveValue(/.+/);
  await expect(subjectSelect.locator('option', { hasText: 'Onboarding E2E' })).toBeAttached();
});

test('un fichier TXT réel reste importable sans Blob.arrayBuffer ni Blob.text', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', { value: undefined, configurable: true });
    Object.defineProperty(Blob.prototype, 'text', { value: undefined, configurable: true });
  });
  await page.goto('/bibliotheque');

  expect(await page.evaluate(() => typeof Blob.prototype.arrayBuffer)).toBe('undefined');
  expect(await page.evaluate(() => typeof Blob.prototype.text)).toBe('undefined');

  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Safari TXT E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('listitem').getByText('Safari TXT E2E', { exact: true })).toBeVisible();

  await page.getByLabel(/Titre/).fill('Notes Safari');
  await page.getByLabel('Fichier du support').setInputFiles({
    name: 'notes-safari.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Ce fichier TXT est réellement lu, extrait et conservé sur Safari.'),
  });

  await expect(page.getByText('notes-safari.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Importer le support' })).toBeEnabled();
  await page.getByRole('button', { name: 'Importer le support' }).click();
  await expect(page.getByRole('heading', { name: 'Notes Safari' })).toBeVisible();

  await page.getByRole('heading', { name: 'Notes Safari' }).click();
  await expect(page.getByText('Ce fichier TXT est réellement lu, extrait et conservé sur Safari.')).toBeVisible();
});

test('un PDF refusé par le lecteur local peut être récupéré par le fallback serveur', async ({ page }) => {
  const extractedText = 'Texte réel récupéré par le moteur serveur de secours.';
  await page.route('**/api/resource-versions/*/server-extraction', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        pages: [{ pageNumber: 1, text: extractedText }],
        charCount: extractedText.length,
      }),
    });
  });

  await page.goto('/bibliotheque');
  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('PDF secours E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('listitem').getByText('PDF secours E2E', { exact: true })).toBeVisible();

  await page.getByLabel(/Titre/).fill('PDF fallback');
  await page.getByLabel('Fichier du support').setInputFiles({
    name: 'fallback.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nce contenu force volontairement un échec du lecteur local'),
  });
  await page.getByRole('button', { name: 'Importer le support' }).click();
  await expect(page.getByRole('heading', { name: 'PDF fallback' })).toBeVisible();
  await page.getByRole('heading', { name: 'PDF fallback' }).click();

  await expect(page.getByText('Prêt', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('caractères extraits', { exact: true })).toBeVisible();
  await expect(page.getByText('Contenu non exploitable automatiquement')).toHaveCount(0);
});

test('un même contenu n’est pas importé deux fois localement', async ({ page }) => {
  await page.goto('/bibliotheque');

  const subjectInput = page.getByLabel('Nouvelle matière', { exact: true }).first();
  if (await subjectInput.isVisible()) {
    await subjectInput.fill('Doublons E2E');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
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

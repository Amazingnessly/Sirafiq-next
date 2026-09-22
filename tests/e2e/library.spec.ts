import { expect, test } from '@playwright/test';

test('matière → texte réel → confirmation → ouverture → persistance après rechargement', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Français E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('listitem').getByText('Français E2E', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByLabel(/Titre/).fill('Lecture test');
  await page.getByLabel('Contenu').fill('Sirāfiq conserve ce texte réel puis le restitue après rechargement.');
  await expect(page.getByRole('button', { name: 'Importer le support' })).toBeEnabled();
  await page.getByRole('button', { name: 'Importer le support' }).click();

  const success = page.getByRole('status').filter({ hasText: 'Support importé' });
  await expect(success).toBeVisible();
  await expect(success.getByRole('link', { name: 'Ouvrir le support' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lecture test' })).toBeVisible();
  await success.getByRole('link', { name: 'Ouvrir le support' }).click();
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

test('un TXT dépassant une page serveur reste synchronisable par blocs bornés', async ({ page }) => {
  const text = 'a'.repeat(250_000) + 'b'.repeat(10_000);

  await page.goto('/bibliotheque');
  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('TXT long E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('listitem').getByText('TXT long E2E', { exact: true })).toBeVisible();

  await page.getByLabel(/Titre/).fill('Long TXT borné');
  await page.getByLabel('Fichier du support').setInputFiles({
    name: 'long.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await page.getByRole('button', { name: 'Importer le support' }).click();

  await expect(page.getByRole('heading', { name: 'Long TXT borné' })).toBeVisible();
  await expect(page.getByText('Synchronisé', { exact: true })).toBeVisible({ timeout: 20_000 });

  const local = await page.evaluate(async (title) => {
    const { db } = await import('/src/data/db.ts');
    await db.open();
    const resource = (await db.resources.toArray()).find((item) => item.title === title);
    if (!resource) throw new Error('Support TXT E2E introuvable');
    const extraction = await db.extractions.get(resource.currentVersionId);
    if (!extraction) throw new Error('Extraction TXT E2E introuvable');
    return {
      syncState: resource.syncState,
      status: extraction.status,
      charCount: extraction.charCount,
      lengths: extraction.pages.map((page) => page.text.length),
      text: extraction.pages.map((page) => page.text).join(''),
    };
  }, 'Long TXT borné');

  expect(local.syncState).toBe('synced');
  expect(local.status).toBe('ready');
  expect(local.charCount).toBe(text.length);
  expect(local.lengths).toEqual([250_000, 10_000]);
  expect(local.text).toBe(text);
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

  await expect(page.getByText('Synchronisé', { exact: true })).toBeVisible({ timeout: 20_000 });
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


test('la bibliothèque restaure matière, recherche et état après ouverture puis rechargement d’un support', async ({ page }) => {
  await page.goto('/bibliotheque');

  await page.getByLabel('Nouvelle matière', { exact: true }).first().fill('Contexte URL E2E');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByLabel(/Titre/).fill('Support filtré');
  await page.getByLabel('Contenu').fill('Contenu servant à vérifier la restauration des filtres de bibliothèque.');
  await page.getByRole('button', { name: 'Importer le support' }).click();
  await expect(page.getByRole('heading', { name: 'Support filtré' })).toBeVisible();

  const subjectButton = page.getByRole('button', { name: /Contexte URL E2E/ });
  await subjectButton.click();
  let libraryUrl = new URL(page.url());
  const subjectId = libraryUrl.searchParams.get('subject');
  expect(subjectId).toBeTruthy();

  const search = page.getByRole('searchbox', { name: 'Rechercher un support' });
  await search.fill('filtré');
  await expect(page).toHaveURL(/q=filtr/);

  await page.getByRole('button', { name: 'Extraits' }).click();
  libraryUrl = new URL(page.url());
  expect(libraryUrl.searchParams.get('subject')).toBe(subjectId);
  expect(libraryUrl.searchParams.get('q')).toBe('filtré');
  expect(libraryUrl.searchParams.get('status')).toBe('ready');

  await page.getByRole('link', { name: /Support filtré/ }).click();
  await expect(page.getByText('Contenu servant à vérifier la restauration des filtres de bibliothèque.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Contenu servant à vérifier la restauration des filtres de bibliothèque.')).toBeVisible();

  await page.getByRole('link', { name: '← Bibliothèque', exact: true }).click();
  const returnedUrl = new URL(page.url());
  expect(returnedUrl.searchParams.get('subject')).toBe(subjectId);
  expect(returnedUrl.searchParams.get('q')).toBe('filtré');
  expect(returnedUrl.searchParams.get('status')).toBe('ready');
  await expect(page.getByRole('searchbox', { name: 'Rechercher un support' })).toHaveValue('filtré');
  await expect(page.getByRole('button', { name: /Contexte URL E2E/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Extraits' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Support filtré' })).toBeVisible();
});

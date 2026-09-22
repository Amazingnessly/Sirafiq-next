import { expect, test } from '@playwright/test';

test('une matière en erreur reconstruit son travail de synchronisation manquant', async ({ page }) => {
  await page.goto('/bibliotheque');

  const subjectId = 'e2e-subject-recovery';
  await page.evaluate(async (id) => {
    const { db } = await import('/src/data/db.ts');
    await db.open();
    const now = new Date().toISOString();
    await db.transaction('rw', db.subjects, db.outbox, async () => {
      await db.subjects.put({
        id,
        name: 'Matière à reprendre',
        parentId: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'error',
        syncError: 'Échec réseau E2E',
      });
      const stale = await db.outbox.where('entityId').equals(id).toArray();
      await db.outbox.bulkDelete(stale.map((item) => item.id));
    });
  }, subjectId);

  let retryRequests = 0;
  await page.route('**/api/subjects/upsert', async (route) => {
    retryRequests += 1;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'E2E_RETRY', message: 'Échec réseau E2E', retryable: true } }),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('link', { name: '1 élément avec une erreur de synchronisation — afficher' })).toBeVisible();

  await page.goto('/bibliotheque');
  const subjectButton = page.getByRole('button', { name: /Matière à reprendre/ });
  await expect(subjectButton).toContainText('à vérifier');
  await subjectButton.click();
  await expect(page.getByRole('button', { name: 'Réessayer la synchronisation' })).toBeVisible();
  await page.getByRole('button', { name: 'Réessayer la synchronisation' }).click();
  await expect.poll(() => retryRequests).toBe(1);

  const recovery = await page.evaluate(async (id) => {
    const { db } = await import('/src/data/db.ts');
    await db.open();
    const [subject, matching] = await Promise.all([
      db.subjects.get(id),
      db.outbox.where('entityId').equals(id).and((item) => item.type === 'subject.upsert').first(),
    ]);
    if (!matching) throw new Error('Le travail de reprise n’a pas été reconstruit');
    return {
      attempts: matching.attempts,
      lastError: matching.lastError,
      syncState: subject?.syncState ?? '',
    };
  }, subjectId);

  expect(recovery.attempts).toBe(1);
  expect(recovery.lastError).toContain('Échec réseau E2E');
  expect(recovery.syncState).toBe('error');
});

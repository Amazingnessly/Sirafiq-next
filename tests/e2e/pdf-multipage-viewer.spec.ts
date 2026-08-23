import { expect, test } from '@playwright/test';

const RESOURCE_ID = '77777777-7777-4777-8777-777777777777';
const VERSION_ID = '88888888-8888-4888-8888-888888888888';
const SUBJECT_ID = '99999999-9999-4999-8999-999999999999';

function makeTwoPagePdf(): Buffer {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '6 0 obj\n<< /Length 37 >>\nstream\nBT /F1 24 Tf 72 720 Td (Page 1) Tj ET\nendstream\nendobj\n',
    '7 0 obj\n<< /Length 37 >>\nstream\nBT /F1 24 Tf 72 720 Td (Page 2) Tj ET\nendstream\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

test('affiche et navigue les pages d’un PDF sans iframe Safari', async ({ page }) => {
  const pdf = makeTwoPagePdf();

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }

    if (request.method() === 'GET' && url.pathname === `/api/resource-versions/${VERSION_ID}/blob`) {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdf.length),
        },
        body: pdf,
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route de test absente.', retryable: false } }),
    });
  });

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId, versionId, subjectId, size }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    await db.subjects.add({ id: subjectId, name: 'Arabe', parentId: null, createdAt: now, updatedAt: now, syncState: 'synced', syncError: null });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'PDF multipage',
      kind: 'pdf',
      currentVersionId: versionId,
      status: 'ready',
      extractionError: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: versionId,
      resourceId,
      sha256: 'b'.repeat(64),
      fileName: 'deux-pages.pdf',
      mimeType: 'application/pdf',
      size,
      bytes: null,
      createdAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.extractions.add({
      versionId,
      status: 'ready',
      pages: [{ pageNumber: 1, text: 'Page 1' }, { pageNumber: 2, text: 'Page 2' }],
      charCount: 12,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
    });
  }, { resourceId: RESOURCE_ID, versionId: VERSION_ID, subjectId: SUBJECT_ID, size: pdf.length });

  await page.goto(`/bibliotheque/${RESOURCE_ID}`);

  await expect(page.getByText('Page 1 sur 2', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.pdf-reader canvas')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);

  await page.getByRole('button', { name: 'Page suivante' }).click();
  await expect(page.getByText('Page 2 sur 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page suivante' })).toBeDisabled();

  await page.getByRole('button', { name: 'Page précédente' }).click();
  await expect(page.getByText('Page 1 sur 2', { exact: true })).toBeVisible();
});

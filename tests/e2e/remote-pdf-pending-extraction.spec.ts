import { expect, test } from '@playwright/test';

const RESOURCE_ID = '82828282-8282-4828-8828-828282828282';
const VERSION_ID = '83838383-8383-4838-8838-838383838383';
const SUBJECT_ID = '84848484-8484-4848-8848-848484848484';

function makePdf(): Buffer {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Length 43 >>\nstream\nBT /F1 18 Tf 72 720 Td (Pending PDF) Tj ET\nendstream\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

function parseRange(header: string, total: number): { start: number; end: number } | null {
  const match = /^bytes=(\d+)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= total || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, total - 1) };
}

test('un PDF distant stocké mais extraction pending peut être repris par le serveur', async ({ page }) => {
  const pdf = makePdf();
  const extractedText = 'Extraction distante reprise après interruption.';
  let recovered = false;
  let extractionCalls = 0;
  let detailRequests = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === `/api/resources/${RESOURCE_ID}`) {
      detailRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resource: {
            id: RESOURCE_ID,
            subjectId: SUBJECT_ID,
            title: 'PDF distant pending',
            kind: 'pdf',
            currentVersionId: VERSION_ID,
            createdAt: '2026-09-23T00:00:00.000Z',
            updatedAt: '2026-09-23T00:00:00.000Z',
          },
          version: {
            id: VERSION_ID,
            fileName: 'pending.pdf',
            mimeType: 'application/pdf',
            size: pdf.length,
            sha256: 'b'.repeat(64),
            status: recovered ? 'ready' : 'stored',
            extractionStatus: recovered ? 'ready' : 'pending',
            extractionError: null,
          },
          extraction: recovered ? {
            pages: [{ pageNumber: 1, text: extractedText }],
            charCount: extractedText.length,
          } : null,
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === `/api/resource-versions/${VERSION_ID}/blob`) {
      const rangeHeader = request.headers()['range'];
      if (rangeHeader) {
        const range = parseRange(rangeHeader, pdf.length);
        if (!range) {
          await route.fulfill({ status: 416, headers: { 'Content-Range': `bytes */${pdf.length}` } });
          return;
        }
        const body = pdf.subarray(range.start, range.end + 1);
        await route.fulfill({
          status: 206,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Type': 'application/pdf',
            'Content-Length': String(body.length),
            'Content-Range': `bytes ${range.start}-${range.end}/${pdf.length}`,
          },
          body,
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdf.length),
        },
        body: pdf,
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/server-extraction`) {
      extractionCalls += 1;
      recovered = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          pages: [{ pageNumber: 1, text: extractedText }],
          charCount: extractedText.length,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route de test absente.', retryable: false } }),
    });
  });

  await page.goto(`/bibliotheque/${RESOURCE_ID}`);

  const recovery = page.getByLabel('Récupération de l’extraction');
  await expect(recovery).toBeVisible();
  const retry = recovery.getByRole('button', { name: 'Retenter l’extraction avec le serveur' });
  await expect(retry).toBeVisible();
  await retry.click();

  await expect(page.getByText(String(extractedText.length), { exact: true })).toBeVisible();
  await expect(page.getByText('caractères extraits', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Récupération de l’extraction')).toHaveCount(0);
  expect(extractionCalls).toBe(1);
  expect(detailRequests).toBeGreaterThanOrEqual(2);
});

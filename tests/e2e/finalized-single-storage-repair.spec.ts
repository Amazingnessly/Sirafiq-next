import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const RESOURCE_ID = '91919191-1111-4111-8111-919191919191';
const VERSION_ID = '92929292-2222-4222-8222-929292929292';
const SUBJECT_ID = '93939393-3333-4333-8333-939393939393';

function makeMinimalPdf(): Buffer {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
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

test('un petit PDF finalisé dont R2 est perdu peut être réparé par resélection SHA-vérifiée', async ({ page }) => {
  const fileBytes = makeMinimalPdf();
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');
  let repaired = false;
  let blobUploads = 0;
  let multipartCalls = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subjects: [], resources: [] }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === `/api/resource-versions/${VERSION_ID}/blob`) {
      if (!repaired) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'FILE_INTEGRITY_ERROR',
              message: 'Le fichier R2 ne correspond plus à la version enregistrée dans D1.',
              retryable: false,
            },
          }),
        });
        return;
      }

      const rangeHeader = request.headers()['range'];
      if (rangeHeader) {
        const range = parseRange(rangeHeader, fileBytes.length);
        if (!range) {
          await route.fulfill({ status: 416, headers: { 'Content-Range': `bytes */${fileBytes.length}` } });
          return;
        }
        const body = fileBytes.subarray(range.start, range.end + 1);
        await route.fulfill({
          status: 206,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Type': 'application/pdf',
            'Content-Length': String(body.length),
            'Content-Range': `bytes ${range.start}-${range.end}/${fileBytes.length}`,
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
          'Content-Length': String(fileBytes.length),
        },
        body: fileBytes,
      });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${VERSION_ID}/blob`) {
      blobUploads += 1;
      repaired = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (url.pathname.includes('/multipart/')) {
      multipartCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNEXPECTED_MULTIPART', message: 'Multipart interdit dans ce test.', retryable: false } }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route E2E absente.', retryable: false } }),
    });
  });

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId, versionId, subjectId, hash, size }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();

    await db.subjects.add({
      id: subjectId,
      name: 'Réparation simple',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'Petit PDF distant à réparer',
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
      sha256: hash,
      fileName: 'petit-original.pdf',
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
      pages: [{ pageNumber: 1, text: 'Extraction locale déjà disponible.' }],
      charCount: 36,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
    });
  }, {
    resourceId: RESOURCE_ID,
    versionId: VERSION_ID,
    subjectId: SUBJECT_ID,
    hash: sha256,
    size: fileBytes.length,
  });

  await page.goto(`/bibliotheque/${RESOURCE_ID}`);

  const repair = page.getByLabel('Réparation du fichier distant');
  await expect(repair).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Le fichier distant doit être réparé.')).toBeVisible();

  const wrongBytes = Buffer.from(fileBytes);
  wrongBytes[wrongBytes.length - 1] ^= 0x01;
  await repair.getByLabel('Fichier original à réparer').setInputFiles({
    name: 'petit-original.pdf',
    mimeType: 'application/pdf',
    buffer: wrongBytes,
  });
  await repair.getByRole('button', { name: 'Réparer le fichier distant' }).click();
  await expect(repair.getByText('Le contenu du fichier sélectionné ne correspond pas au support à reprendre.')).toBeVisible();
  expect(blobUploads).toBe(0);

  await repair.getByLabel('Fichier original à réparer').setInputFiles({
    name: 'petit-original.pdf',
    mimeType: 'application/pdf',
    buffer: fileBytes,
  });
  await repair.getByRole('button', { name: 'Réparer le fichier distant' }).click();

  await expect.poll(() => blobUploads).toBe(1);
  expect(multipartCalls).toBe(0);
  await expect(page.getByLabel('Réparation du fichier distant')).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Aller à la page' })).toBeVisible({ timeout: 20_000 });

  await expect.poll(async () => page.evaluate(async ({ resourceId, versionId }) => {
    const { db } = await import('/src/data/db.ts');
    const [resource, version, session] = await Promise.all([
      db.resources.get(resourceId),
      db.resourceVersions.get(versionId),
      db.multipartUploads.get(versionId),
    ]);
    return {
      resourceState: resource?.syncState,
      versionState: version?.syncState,
      hasSession: Boolean(session),
    };
  }, { resourceId: RESOURCE_ID, versionId: VERSION_ID })).toEqual({
    resourceState: 'synced',
    versionState: 'synced',
    hasSession: false,
  });
});

import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const MIB = 1024 * 1024;
const RESOURCE_ID = '73737373-7373-4737-8737-737373737373';
const VERSION_ID = '74747474-7474-4747-8747-747474747474';
const SUBJECT_ID = '75757575-7575-4757-8757-757575757575';

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

test('un multipart finalisé dont R2 est corrompu peut être réparé par resélection SHA-vérifiée', async ({ page }) => {
  const fileBytes = Buffer.alloc(25 * MIB + 1, 11);
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');
  const readablePdf = makeMinimalPdf();
  const uploadedParts: number[] = [];
  let repaired = false;
  let completeCalls = 0;

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
      await route.fulfill({
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Type': 'application/pdf',
          'Content-Length': String(readablePdf.length),
        },
        body: readablePdf,
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, uploadMode: 'multipart', alreadyStored: false }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/create`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uploadId: 'repair-upload',
          partSize: 8 * MIB,
          parts: [],
        }),
      });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/part`) {
      const partNumber = Number(url.searchParams.get('partNumber'));
      uploadedParts.push(partNumber);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ partNumber, etag: `repair-etag-${partNumber}` }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/multipart/complete`) {
      completeCalls += 1;
      repaired = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, size: fileBytes.length, etag: 'repair-final-etag' }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${VERSION_ID}/extraction-failure`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'NOT_FOUND', message: 'Route E2E absente.', retryable: false },
      }),
    });
  });

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ resourceId, versionId, subjectId, hash, size }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    await db.subjects.add({
      id: subjectId,
      name: 'Réparation multipart',
      parentId: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resources.add({
      id: resourceId,
      subjectId,
      title: 'PDF distant à réparer',
      kind: 'pdf',
      currentVersionId: versionId,
      status: 'failed',
      extractionError: 'Extraction différée pour gros fichier.',
      createdAt: now,
      updatedAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.resourceVersions.add({
      id: versionId,
      resourceId,
      sha256: hash,
      fileName: 'gros-original.pdf',
      mimeType: 'application/pdf',
      size,
      bytes: null,
      createdAt: now,
      syncState: 'synced',
      syncError: null,
    });
    await db.extractions.add({
      versionId,
      status: 'failed',
      pages: [],
      charCount: 0,
      errorCode: 'LARGE_FILE_EXTRACTION_DEFERRED',
      errorMessage: 'Extraction différée pour gros fichier.',
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
  await expect(page.getByText('Le fichier distant n’est pas déclaré consultable tant que sa réparation R2 n’est pas terminée.')).toBeVisible();

  await repair.getByLabel('Fichier original à réparer').setInputFiles({
    name: 'gros-original.pdf',
    mimeType: 'application/pdf',
    buffer: fileBytes,
  });
  await repair.getByRole('button', { name: 'Réparer le fichier distant' }).click();

  await expect.poll(() => completeCalls, { timeout: 30_000 }).toBe(1);
  expect(uploadedParts).toEqual([1, 2, 3, 4]);

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
      session: Boolean(session),
    };
  }, {
    resourceId: RESOURCE_ID,
    versionId: VERSION_ID,
  }), { timeout: 30_000 }).toEqual({
    resourceState: 'synced',
    versionState: 'synced',
    session: false,
  });

  await expect(page.getByLabel('Réparation du fichier distant')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';

test('un support standard attend la réussite de sa matière avant D1', async ({ page }) => {
  const subjectId = 'e2e-dependent-subject';
  const resourceId = 'e2e-dependent-resource';
  const versionId = 'e2e-dependent-version';
  const order: string[] = [];
  let subjectAttempts = 0;
  let prematureRegistration = false;

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

    if (request.method() === 'POST' && url.pathname === '/api/subjects/upsert') {
      subjectAttempts += 1;
      order.push(`subject-${subjectAttempts}`);
      if (subjectAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'SUBJECT_TRANSIENT_E2E', message: 'Matière temporairement indisponible', retryable: true },
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      order.push('resource-register');
      if (subjectAttempts < 2) {
        prematureRegistration = true;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'SUBJECT_MISSING', message: 'La matière manque encore.', retryable: true },
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, uploadMode: 'single' }) });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${versionId}/blob`) {
      order.push('blob');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${versionId}/extraction`) {
      order.push('extraction');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route E2E absente.', retryable: false } }),
    });
  });

  await page.goto('/bibliotheque');

  await page.evaluate(async ({ subjectId: sid, resourceId: rid, versionId: vid }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    const bytes = new TextEncoder().encode('Support dépendant de sa matière').buffer;
    await db.transaction('rw', db.subjects, db.resources, db.resourceVersions, db.extractions, db.outbox, async () => {
      await db.subjects.put({
        id: sid,
        name: 'Matière dépendante',
        parentId: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.resources.put({
        id: rid,
        subjectId: sid,
        title: 'Support dépendant',
        kind: 'text',
        currentVersionId: vid,
        status: 'ready',
        extractionError: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.resourceVersions.put({
        id: vid,
        resourceId: rid,
        sha256: 'd'.repeat(64),
        fileName: 'dependent.txt',
        mimeType: 'text/plain',
        size: bytes.byteLength,
        bytes,
        createdAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.extractions.put({
        versionId: vid,
        status: 'ready',
        pages: [{ pageNumber: 1, text: 'Support dépendant de sa matière' }],
        charCount: 31,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
      });
      await db.outbox.bulkAdd([
        {
          id: 'e2e-dependent-subject-work',
          type: 'subject.upsert',
          entityId: sid,
          attempts: 5,
          nextAttemptAt: Date.now(),
          lastError: null,
          createdAt: new Date(Date.now() - 1000).toISOString(),
        },
        {
          id: 'e2e-dependent-resource-work',
          type: 'resource.sync',
          entityId: rid,
          attempts: 0,
          nextAttemptAt: Date.now(),
          lastError: null,
          createdAt: now,
        },
      ]);
    });

    const { requestSync } = await import('/src/lib/sync.ts');
    // The application starts one sync pass on mount. If our fixture is seeded
    // while that empty pass is still active, the first call deliberately joins
    // it. A second call then starts a fresh pass over the seeded outbox.
    await requestSync();
    await requestSync();
  }, { subjectId, resourceId, versionId });

  expect(prematureRegistration).toBe(false);
  expect(subjectAttempts).toBe(1);
  expect(order).toEqual(['subject-1']);

  const deferred = await page.evaluate(async ({ subjectId: sid, resourceId: rid }) => {
    const { db } = await import('/src/data/db.ts');
    const [subjectWork, resourceWork] = await Promise.all([
      db.outbox.where('entityId').equals(sid).and((item) => item.type === 'subject.upsert').first(),
      db.outbox.where('entityId').equals(rid).and((item) => item.type === 'resource.sync').first(),
    ]);
    return {
      subjectRetryInFuture: Boolean(subjectWork && subjectWork.nextAttemptAt > Date.now()),
      resourceRetryInFuture: Boolean(resourceWork && resourceWork.nextAttemptAt > Date.now()),
      sameRetryDeadline: Boolean(subjectWork && resourceWork && subjectWork.nextAttemptAt === resourceWork.nextAttemptAt),
      subjectAttempts: subjectWork?.attempts ?? -1,
      resourceAttempts: resourceWork?.attempts ?? -1,
      subjectError: subjectWork?.lastError ?? null,
      resourceError: resourceWork?.lastError ?? null,
    };
  }, { subjectId, resourceId });

  expect(deferred).toEqual({
    subjectRetryInFuture: true,
    resourceRetryInFuture: true,
    sameRetryDeadline: true,
    subjectAttempts: 6,
    resourceAttempts: 0,
    subjectError: 'Matière temporairement indisponible',
    resourceError: 'Matière temporairement indisponible',
  });

  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect.poll(() => subjectAttempts).toBe(2);
  await expect.poll(() => order.includes('resource-register')).toBe(true);
  expect(prematureRegistration).toBe(false);
  expect(order.slice(0, 3)).toEqual(['subject-1', 'subject-2', 'resource-register']);
  expect(order).toContain('blob');
  expect(order).toContain('extraction');

  const local = await page.evaluate(async ({ subjectId: sid, resourceId: rid }) => {
    const { db } = await import('/src/data/db.ts');
    const [subject, resource, remaining] = await Promise.all([
      db.subjects.get(sid),
      db.resources.get(rid),
      db.outbox.toArray(),
    ]);
    return {
      subjectState: subject?.syncState,
      resourceState: resource?.syncState,
      remaining: remaining.filter((item) => item.entityId === sid || item.entityId === rid).length,
    };
  }, { subjectId, resourceId });

  expect(local).toEqual({
    subjectState: 'synced',
    resourceState: 'synced',
    remaining: 0,
  });
});


test('un SUBJECT_MISSING répare une matière localement synced puis retente une seule fois', async ({ page }) => {
  const subjectId = 'e2e-stale-synced-subject';
  const resourceId = 'e2e-stale-synced-resource';
  const versionId = 'e2e-stale-synced-version';
  const order: string[] = [];
  let registerAttempts = 0;
  let subjectRepairs = 0;

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

    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      registerAttempts += 1;
      order.push(`resource-${registerAttempts}`);
      if (registerAttempts === 1) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'SUBJECT_MISSING',
              message: 'La matière n’existe plus dans D1.',
              retryable: true,
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, uploadMode: 'single' }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/subjects/upsert') {
      subjectRepairs += 1;
      order.push('subject-repair');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${versionId}/blob`) {
      order.push('blob');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${versionId}/extraction`) {
      order.push('extraction');
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
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route E2E absente.', retryable: false } }),
    });
  });

  await page.goto('/bibliotheque');

  await page.evaluate(async ({ subjectId: sid, resourceId: rid, versionId: vid }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    const text = 'Support avec matière locale obsolète';
    const bytes = new TextEncoder().encode(text).buffer;

    await db.transaction('rw', db.subjects, db.resources, db.resourceVersions, db.extractions, db.outbox, async () => {
      await db.subjects.put({
        id: sid,
        name: 'Matière locale déclarée synchronisée',
        parentId: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'synced',
        syncError: null,
      });
      await db.resources.put({
        id: rid,
        subjectId: sid,
        title: 'Support après perte D1',
        kind: 'text',
        currentVersionId: vid,
        status: 'ready',
        extractionError: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.resourceVersions.put({
        id: vid,
        resourceId: rid,
        sha256: 'e'.repeat(64),
        fileName: 'stale-subject.txt',
        mimeType: 'text/plain',
        size: bytes.byteLength,
        bytes,
        createdAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.extractions.put({
        versionId: vid,
        status: 'ready',
        pages: [{ pageNumber: 1, text }],
        charCount: text.length,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
      });
      await db.outbox.add({
        id: 'e2e-stale-synced-resource-work',
        type: 'resource.sync',
        entityId: rid,
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
        createdAt: now,
      });
    });

    const { requestSync } = await import('/src/lib/sync.ts');
    await requestSync();
    await requestSync();
  }, { subjectId, resourceId, versionId });

  expect(registerAttempts).toBe(2);
  expect(subjectRepairs).toBe(1);
  expect(order.slice(0, 3)).toEqual(['resource-1', 'subject-repair', 'resource-2']);
  expect(order).toContain('blob');
  expect(order).toContain('extraction');

  const local = await page.evaluate(async ({ subjectId: sid, resourceId: rid }) => {
    const { db } = await import('/src/data/db.ts');
    const [subject, resource, remaining] = await Promise.all([
      db.subjects.get(sid),
      db.resources.get(rid),
      db.outbox.toArray(),
    ]);
    return {
      subjectState: subject?.syncState,
      subjectError: subject?.syncError,
      resourceState: resource?.syncState,
      remaining: remaining.filter((item) => item.entityId === sid || item.entityId === rid).length,
    };
  }, { subjectId, resourceId });

  expect(local).toEqual({
    subjectState: 'synced',
    subjectError: null,
    resourceState: 'synced',
    remaining: 0,
  });
});

test('une reprise manuelle de matière libère immédiatement ses supports différés', async ({ page }) => {
  const subjectId = 'e2e-manual-subject-retry';
  const resourceId = 'e2e-manual-dependent-resource';
  const versionId = 'e2e-manual-dependent-version';
  const order: string[] = [];

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
    if (request.method() === 'POST' && url.pathname === '/api/subjects/upsert') {
      order.push('subject');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      order.push('resource-register');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, uploadMode: 'single' }),
      });
      return;
    }
    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${versionId}/blob`) {
      order.push('blob');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${versionId}/extraction`) {
      order.push('extraction');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route E2E absente.', retryable: false } }),
    });
  });

  await page.goto('/bibliotheque');

  await page.evaluate(async ({ subjectId: sid, resourceId: rid, versionId: vid }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    const retryAt = Date.now() + 120_000;
    const text = 'Support différé derrière une matière en erreur';
    const bytes = new TextEncoder().encode(text).buffer;

    await db.transaction('rw', db.subjects, db.resources, db.resourceVersions, db.extractions, db.outbox, async () => {
      await db.subjects.put({
        id: sid,
        name: 'Matière à relancer manuellement',
        parentId: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'error',
        syncError: 'Matière temporairement indisponible',
      });
      await db.resources.put({
        id: rid,
        subjectId: sid,
        title: 'Support différé',
        kind: 'text',
        currentVersionId: vid,
        status: 'ready',
        extractionError: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.resourceVersions.put({
        id: vid,
        resourceId: rid,
        sha256: 'f'.repeat(64),
        fileName: 'deferred.txt',
        mimeType: 'text/plain',
        size: bytes.byteLength,
        bytes,
        createdAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.extractions.put({
        versionId: vid,
        status: 'ready',
        pages: [{ pageNumber: 1, text }],
        charCount: text.length,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
      });
      await db.outbox.bulkPut([
        {
          id: 'e2e-manual-subject-work',
          type: 'subject.upsert',
          entityId: sid,
          attempts: 3,
          nextAttemptAt: retryAt,
          lastError: 'Matière temporairement indisponible',
          createdAt: now,
        },
        {
          id: 'e2e-manual-resource-work',
          type: 'resource.sync',
          entityId: rid,
          attempts: 0,
          nextAttemptAt: retryAt,
          lastError: 'Matière temporairement indisponible',
          createdAt: now,
        },
      ]);
    });
  }, { subjectId, resourceId, versionId });

  await page.goto(`/bibliotheque?subject=${subjectId}`);
  await expect(page.getByRole('button', { name: 'Réessayer la synchronisation' })).toBeVisible();
  await page.getByRole('button', { name: 'Réessayer la synchronisation' }).click();

  await expect.poll(() => order.includes('extraction')).toBe(true);
  expect(order).toEqual(['subject', 'resource-register', 'blob', 'extraction']);

  const local = await page.evaluate(async ({ subjectId: sid, resourceId: rid }) => {
    const { db } = await import('/src/data/db.ts');
    const [subject, resource, remaining] = await Promise.all([
      db.subjects.get(sid),
      db.resources.get(rid),
      db.outbox.toArray(),
    ]);
    return {
      subjectState: subject?.syncState,
      resourceState: resource?.syncState,
      remaining: remaining.filter((item) => item.entityId === sid || item.entityId === rid).length,
    };
  }, { subjectId, resourceId });

  expect(local).toEqual({
    subjectState: 'synced',
    resourceState: 'synced',
    remaining: 0,
  });
});

test('la file standard et un multipart partagent une seule synchronisation de matière', async ({ page }) => {
  const subjectId = 'e2e-coalesced-subject';
  const resourceId = 'e2e-coalesced-multipart-resource';
  const versionId = 'e2e-coalesced-multipart-version';
  const fileSize = 1024;
  const fileByte = 3;
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(Buffer.alloc(fileSize, fileByte)).digest('hex');
  let subjectAttempts = 0;
  let releaseFirstSubject!: () => void;
  const secondSubjectAttempt = new Promise<void>((resolve) => {
    releaseFirstSubject = resolve;
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [], resources: [] }) });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/subjects/upsert') {
      subjectAttempts += 1;
      if (subjectAttempts === 1) {
        await Promise.race([
          secondSubjectAttempt,
          new Promise<void>((resolve) => setTimeout(resolve, 400)),
        ]);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }

      releaseFirstSubject();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'DUPLICATE_SUBJECT_RACE_E2E',
            message: 'La requête concurrente ne doit jamais exister.',
            retryable: true,
          },
        }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/resources/register') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, uploadMode: 'multipart' }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${versionId}/multipart/create`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uploadId: 'coalesced-upload', partSize: fileSize, parts: [] }),
      });
      return;
    }
    if (request.method() === 'PUT' && url.pathname === `/api/resource-versions/${versionId}/multipart/part`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ partNumber: 1, etag: 'coalesced-etag' }),
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${versionId}/multipart/complete`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, size: fileSize, etag: 'final-etag' }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/resource-versions/${versionId}/extraction-failure`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route E2E absente.', retryable: false } }),
    });
  });

  await page.goto('/bibliotheque');
  await page.evaluate(async ({ subjectId: sid, resourceId: rid, versionId: vid, hash, size }) => {
    const { db } = await import('/src/data/db.ts');
    const now = new Date().toISOString();
    await db.transaction('rw', db.subjects, db.resources, db.resourceVersions, db.extractions, db.multipartUploads, db.outbox, async () => {
      await db.subjects.put({
        id: sid,
        name: 'Matière concurrence',
        parentId: null,
        createdAt: now,
        updatedAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.resources.put({
        id: rid,
        subjectId: sid,
        title: 'Multipart concurrence',
        kind: 'pdf',
        currentVersionId: vid,
        status: 'failed',
        extractionError: 'Extraction différée.',
        createdAt: now,
        updatedAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.resourceVersions.put({
        id: vid,
        resourceId: rid,
        sha256: hash,
        fileName: 'concurrence.pdf',
        mimeType: 'application/pdf',
        size,
        bytes: null,
        createdAt: now,
        syncState: 'pending',
        syncError: null,
      });
      await db.extractions.put({
        versionId: vid,
        status: 'failed',
        pages: [],
        charCount: 0,
        errorCode: 'LARGE_FILE_EXTRACTION_DEFERRED',
        errorMessage: 'Extraction différée.',
        createdAt: now,
      });
      await db.multipartUploads.put({
        versionId: vid,
        resourceId: rid,
        fileName: 'concurrence.pdf',
        size,
        lastModified: 0,
        sha256: hash,
        uploadId: null,
        partSize: size,
        parts: [],
        status: 'pending',
        error: null,
        updatedAt: now,
      });
      await db.outbox.put({
        id: 'e2e-coalesced-subject-work',
        type: 'subject.upsert',
        entityId: sid,
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
        createdAt: now,
      });
    });

    const { requestSync } = await import('/src/lib/sync.ts');
    void requestSync().then(() => requestSync());
  }, { subjectId, resourceId, versionId, hash: sha256, size: fileSize });

  await expect.poll(() => subjectAttempts).toBe(1);

  await page.evaluate(async ({ rid, size, byte }) => {
    const { uploadMultipartResourceWithRecovery } = await import('/src/lib/multipartRecovery.ts');
    const bytes = new Uint8Array(size);
    bytes.fill(byte);
    const file = new File([bytes], 'concurrence.pdf', { type: 'application/pdf' });
    void uploadMultipartResourceWithRecovery(rid, file).catch(() => undefined);
  }, { rid: resourceId, size: fileSize, byte: fileByte });

  await expect.poll(async () => page.evaluate(async (vid) => {
    const { db } = await import('/src/data/db.ts');
    return (await db.multipartUploads.get(vid))?.status;
  }, versionId)).toBe('uploading');

  await expect.poll(async () => page.evaluate(async (rid) => {
    const { db } = await import('/src/data/db.ts');
    return (await db.resources.get(rid))?.syncState;
  }, resourceId), { timeout: 10_000 }).toBe('synced');

  expect(subjectAttempts).toBe(1);
  const subject = await page.evaluate(async (sid) => {
    const { db } = await import('/src/data/db.ts');
    return db.subjects.get(sid);
  }, subjectId);
  expect(subject?.syncState).toBe('synced');
  expect(subject?.syncError).toBeNull();
});


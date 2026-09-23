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
          attempts: 0,
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
    await requestSync();
  }, { subjectId, resourceId, versionId });

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

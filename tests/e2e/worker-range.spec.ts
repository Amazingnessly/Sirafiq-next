import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const SUBJECT_ID = '12121212-1212-4121-8121-121212121212';
const RESOURCE_ID = '23232323-2323-4232-8232-232323232323';
const VERSION_ID = '34343434-3434-4343-8343-343434343434';

test('le Worker sert réellement les blobs R2 par plages HTTP', async ({ request }) => {
  const bytes = Buffer.from('0123456789abcdef', 'ascii');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const now = '2026-09-22T00:00:00.000Z';

  const subject = await request.post('/api/subjects/upsert', {
    data: {
      id: SUBJECT_ID,
      name: 'Range Worker E2E',
      parentId: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  expect(subject.ok()).toBe(true);

  const registration = await request.post('/api/resources/register', {
    data: {
      resource: {
        id: RESOURCE_ID,
        subjectId: SUBJECT_ID,
        title: 'PDF Range Worker',
        kind: 'pdf',
        currentVersionId: VERSION_ID,
        createdAt: now,
        updatedAt: now,
      },
      version: {
        id: VERSION_ID,
        resourceId: RESOURCE_ID,
        sha256,
        fileName: 'range.pdf',
        mimeType: 'application/pdf',
        size: bytes.length,
        createdAt: now,
      },
    },
  });
  expect(registration.ok()).toBe(true);

  const upload = await request.put(`/api/resource-versions/${VERSION_ID}/blob`, {
    data: bytes,
    headers: { 'Content-Type': 'application/pdf' },
  });
  expect(upload.ok()).toBe(true);

  // Verify the ordinary full-object path before issuing ranged reads. The
  // Cloudflare local R2 adapter can retain range state between sequential
  // requests in the same test context, which is not representative of R2.
  const full = await request.get(`/api/resource-versions/${VERSION_ID}/blob`);
  expect(full.status()).toBe(200);
  expect(full.headers()['accept-ranges']).toBe('bytes');
  expect(full.headers()['content-length']).toBe(String(bytes.length));
  expect(Buffer.from(await full.body())).toEqual(bytes);

  const partial = await request.get(`/api/resource-versions/${VERSION_ID}/blob`, {
    headers: { Range: 'bytes=4-9' },
  });
  expect(partial.status()).toBe(206);
  expect(partial.headers()['accept-ranges']).toBe('bytes');
  expect(partial.headers()['content-range']).toBe(`bytes 4-9/${bytes.length}`);
  expect(partial.headers()['content-length']).toBe('6');
  expect(Buffer.from(await partial.body())).toEqual(bytes.subarray(4, 10));

  const suffix = await request.get(`/api/resource-versions/${VERSION_ID}/blob`, {
    headers: { Range: 'bytes=-4' },
  });
  expect(suffix.status()).toBe(206);
  expect(suffix.headers()['content-range']).toBe(`bytes 12-15/${bytes.length}`);
  expect(Buffer.from(await suffix.body())).toEqual(bytes.subarray(12));

  const openEnded = await request.get(`/api/resource-versions/${VERSION_ID}/blob`, {
    headers: { Range: 'bytes=10-' },
  });
  expect(openEnded.status()).toBe(206);
  expect(openEnded.headers()['content-range']).toBe(`bytes 10-15/${bytes.length}`);
  expect(openEnded.headers()['content-length']).toBe('6');
  expect(Buffer.from(await openEnded.body())).toEqual(bytes.subarray(10));
});

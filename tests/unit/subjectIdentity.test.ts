import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';

const SUBJECT_ID = '41414141-1111-4111-8111-111111111111';
const OTHER_PARENT_ID = '42424242-1111-4111-8111-111111111111';
const CREATED_AT = '2026-09-28T00:00:00.000Z';

function request(body: {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return new Request('https://example.test/api/subjects/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('subject identity persistence', () => {
  it('accepts an idempotent retry of the same subject identity', async () => {
    let writes = 0;
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => {
            if (sql.includes('SELECT name, parent_id, created_at')) {
              return {
                first: async () => ({
                  name: 'Matière stable',
                  parent_id: null,
                  created_at: CREATED_AT,
                }),
              };
            }
            if (sql.includes('INSERT INTO subjects')) {
              return {
                run: async () => {
                  writes += 1;
                  return { meta: { changes: 1 } };
                },
              };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
      },
    };

    const response = await worker.fetch(request({
      id: SUBJECT_ID,
      name: 'Matière stable',
      parentId: null,
      createdAt: CREATED_AT,
      updatedAt: '2026-09-28T00:01:00.000Z',
    }), env as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(writes).toBe(1);
  });

  it('rejects reuse of a subject UUID for a different stable identity before writing D1', async () => {
    const persisted = {
      name: 'Matière stable',
      parent_id: null as string | null,
      created_at: CREATED_AT,
    };
    const conflicts = [
      { ...persisted, name: 'Autre matière' },
      { ...persisted, parent_id: OTHER_PARENT_ID },
      { ...persisted, created_at: '2026-09-27T00:00:00.000Z' },
    ];

    for (const existing of conflicts) {
      let writes = 0;
      const env = {
        DB: {
          prepare: (sql: string) => ({
            bind: () => {
              if (sql.includes('SELECT name, parent_id, created_at')) {
                return { first: async () => existing };
              }
              if (sql.includes('INSERT INTO subjects')) {
                return {
                  run: async () => {
                    writes += 1;
                    return { meta: { changes: 1 } };
                  },
                };
              }
              throw new Error(`Unexpected SQL: ${sql}`);
            },
          }),
        },
      };

      const response = await worker.fetch(request({
        id: SUBJECT_ID,
        name: 'Matière stable',
        parentId: null,
        createdAt: CREATED_AT,
        updatedAt: '2026-09-28T00:01:00.000Z',
      }), env as never);
      const payload = await response.json() as {
        error: { code: string; retryable: boolean };
      };

      expect(response.status).toBe(409);
      expect(payload.error.code).toBe('SUBJECT_IDENTITY_CONFLICT');
      expect(payload.error.retryable).toBe(false);
      expect(writes).toBe(0);
    }
  });
});

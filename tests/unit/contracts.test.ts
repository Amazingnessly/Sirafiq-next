import { describe, expect, it } from 'vitest';
import { ExtractionUploadSchema, ResourceRegisterSchema } from '../../src/shared/contracts';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';
const UUID_C = '00000000-0000-4000-8000-000000000003';

describe('contrats API', () => {
  it('refuse une version au-delà de 25 Mo', () => {
    const result = ResourceRegisterSchema.safeParse({
      resource: {
        id: UUID_A,
        subjectId: UUID_B,
        title: 'Cours',
        kind: 'pdf',
        currentVersionId: UUID_C,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      version: {
        id: UUID_C,
        resourceId: UUID_A,
        sha256: 'a'.repeat(64),
        fileName: 'cours.pdf',
        mimeType: 'application/pdf',
        size: 25 * 1024 * 1024 + 1,
        createdAt: new Date().toISOString(),
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepte une extraction paginée cohérente', () => {
    const result = ExtractionUploadSchema.safeParse({
      status: 'ready',
      pages: [{ pageNumber: 1, text: 'Texte réel du support.' }],
      charCount: 22,
    });
    expect(result.success).toBe(true);
  });
});

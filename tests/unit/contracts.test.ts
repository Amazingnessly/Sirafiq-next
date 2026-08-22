import { describe, expect, it } from 'vitest';
import { ExtractionUploadSchema, ResourceRegisterSchema } from '../../src/shared/contracts';
import { MAX_SYNC_FILE_BYTES, shouldTryServerPdfExtraction } from '../../src/shared/importPolicy';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';
const UUID_C = '00000000-0000-4000-8000-000000000003';

function resourcePayload(size: number) {
  return {
    resource: {
      id: UUID_A,
      subjectId: UUID_B,
      title: 'Cours',
      kind: 'pdf' as const,
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
      size,
      createdAt: new Date().toISOString(),
    },
  };
}

describe('contrats API', () => {
  it('accepte la synchronisation d’un fichier supérieur à 25 Mo mais sous la limite R2', () => {
    const result = ResourceRegisterSchema.safeParse(resourcePayload(30 * 1024 * 1024));
    expect(result.success).toBe(true);
  });

  it('refuse une version au-delà de la limite de synchronisation', () => {
    const result = ResourceRegisterSchema.safeParse(resourcePayload(MAX_SYNC_FILE_BYTES + 1));
    expect(result.success).toBe(false);
  });

  it('réserve le fallback serveur aux PDF en échec de 25 Mo maximum', () => {
    expect(shouldTryServerPdfExtraction('pdf', 9.3 * 1024 * 1024, 'failed')).toBe(true);
    expect(shouldTryServerPdfExtraction('pdf', 26 * 1024 * 1024, 'failed')).toBe(false);
    expect(shouldTryServerPdfExtraction('text', 1024, 'failed')).toBe(false);
    expect(shouldTryServerPdfExtraction('pdf', 1024, 'ready')).toBe(false);
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

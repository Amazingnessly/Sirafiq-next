import { describe, expect, it } from 'vitest';
import { ExtractionUploadSchema, MultipartCreateSchema, ResourceRegisterSchema } from '../../src/shared/contracts';
import {
  MAX_RESOURCE_FILE_BYTES,
  MULTIPART_MAX_PARTS,
  MULTIPART_PART_BYTES,
  MULTIPART_UPLOAD_THRESHOLD_BYTES,
  multipartPartCount,
  shouldTryServerPdfExtraction,
  shouldUseMultipartUpload,
} from '../../src/shared/importPolicy';

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
  it('accepte les métadonnées de fichiers multipart supérieurs à 100 Mo', () => {
    expect(ResourceRegisterSchema.safeParse(resourcePayload(300 * 1024 * 1024)).success).toBe(true);
    expect(shouldUseMultipartUpload(300 * 1024 * 1024)).toBe(true);
  });

  it('bascule au multipart seulement au-delà du chemin simple', () => {
    expect(shouldUseMultipartUpload(MULTIPART_UPLOAD_THRESHOLD_BYTES)).toBe(false);
    expect(shouldUseMultipartUpload(MULTIPART_UPLOAD_THRESHOLD_BYTES + 1)).toBe(true);
    expect(MultipartCreateSchema.safeParse({ partSize: MULTIPART_PART_BYTES }).success).toBe(true);
  });

  it('garantit au maximum les 10 000 parties permises par R2 avec les morceaux iPad de 8 MiB', () => {
    expect(multipartPartCount(MAX_RESOURCE_FILE_BYTES)).toBe(MULTIPART_MAX_PARTS);
    expect(ResourceRegisterSchema.safeParse(resourcePayload(MAX_RESOURCE_FILE_BYTES)).success).toBe(true);
    expect(ResourceRegisterSchema.safeParse(resourcePayload(MAX_RESOURCE_FILE_BYTES + 1)).success).toBe(false);
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

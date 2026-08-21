import { z } from 'zod';

export const ResourceKindSchema = z.enum(['text', 'pdf']);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

export const SubjectUpsertSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SubjectUpsertInput = z.infer<typeof SubjectUpsertSchema>;

export const ResourceRegisterSchema = z.object({
  resource: z.object({
    id: z.string().uuid(),
    subjectId: z.string().uuid(),
    title: z.string().trim().min(1).max(240),
    kind: ResourceKindSchema,
    currentVersionId: z.string().uuid(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
  version: z.object({
    id: z.string().uuid(),
    resourceId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    size: z.number().int().nonnegative().max(25 * 1024 * 1024),
    createdAt: z.string().datetime(),
  }),
});
export type ResourceRegisterInput = z.infer<typeof ResourceRegisterSchema>;

export const ExtractedPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string().max(250_000),
});
export type ExtractedPage = z.infer<typeof ExtractedPageSchema>;

export const ExtractionUploadSchema = z.object({
  status: z.literal('ready'),
  pages: z.array(ExtractedPageSchema).min(1).max(500),
  charCount: z.number().int().nonnegative().max(2_000_000),
});
export type ExtractionUploadInput = z.infer<typeof ExtractionUploadSchema>;

export const ExtractionFailureSchema = z.object({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(1000),
});
export type ExtractionFailureInput = z.infer<typeof ExtractionFailureSchema>;

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
};

export type BootstrapPayload = {
  subjects: Array<{
    id: string;
    name: string;
    parentId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  resources: Array<{
    id: string;
    subjectId: string;
    title: string;
    kind: ResourceKind;
    currentVersionId: string;
    status: 'uploading' | 'stored' | 'ready' | 'failed';
    extractionCharCount: number | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type ResourceDetailPayload = {
  resource: {
    id: string;
    subjectId: string;
    title: string;
    kind: ResourceKind;
    currentVersionId: string;
    createdAt: string;
    updatedAt: string;
  };
  version: {
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    sha256: string;
    status: 'uploading' | 'stored' | 'ready' | 'failed';
    extractionStatus: 'pending' | 'ready' | 'failed';
    extractionError: string | null;
  };
  extraction: {
    pages: ExtractedPage[];
    charCount: number;
  } | null;
};

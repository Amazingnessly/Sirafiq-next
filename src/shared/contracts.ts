import { z } from 'zod';
import { MAX_EXTRACTED_CHARS, MAX_EXTRACTED_PAGES, MAX_RESOURCE_FILE_BYTES } from './importPolicy';

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
    size: z.number().int().nonnegative().max(MAX_RESOURCE_FILE_BYTES),
    createdAt: z.string().datetime(),
  }),
});
export type ResourceRegisterInput = z.infer<typeof ResourceRegisterSchema>;

export const MultipartCreateSchema = z.object({
  partSize: z.number().int().min(5 * 1024 * 1024).max(90 * 1024 * 1024),
  restart: z.boolean().optional().default(false),
});
export type MultipartCreateInput = z.infer<typeof MultipartCreateSchema>;

export const UploadedPartSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1).max(512),
});
export type UploadedPart = z.infer<typeof UploadedPartSchema>;

export const MultipartCreateResultSchema = z.object({
  uploadId: z.string().min(1),
  partSize: z.number().int().positive(),
  parts: z.array(UploadedPartSchema),
});
export type MultipartCreateResult = z.infer<typeof MultipartCreateResultSchema>;

export const MultipartCompleteSchema = z.object({
  uploadId: z.string().min(1),
});
export type MultipartCompleteInput = z.infer<typeof MultipartCompleteSchema>;

export const ExtractedPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string().max(250_000),
});
export type ExtractedPage = z.infer<typeof ExtractedPageSchema>;

export const ExtractionUploadSchema = z.object({
  status: z.literal('ready'),
  pages: z.array(ExtractedPageSchema).min(1).max(MAX_EXTRACTED_PAGES),
  charCount: z.number().int().nonnegative().max(MAX_EXTRACTED_CHARS),
});
export type ExtractionUploadInput = z.infer<typeof ExtractionUploadSchema>;

export const ExtractionFailureSchema = z.object({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(1000),
});
export type ExtractionFailureInput = z.infer<typeof ExtractionFailureSchema>;

export const ServerExtractionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    pages: z.array(ExtractedPageSchema).min(1).max(MAX_EXTRACTED_PAGES),
    charCount: z.number().int().nonnegative().max(MAX_EXTRACTED_CHARS),
  }),
  z.object({
    status: z.literal('failed'),
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(1000),
  }),
]);
export type ServerExtractionResult = z.infer<typeof ServerExtractionResultSchema>;

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

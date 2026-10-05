import { describe, expect, it } from 'vitest';
import type { MultipartUploadRecord, OutboxRecord, ResourceRecord, SubjectRecord } from '../../src/data/db';
import { classifySyncRecoveryState } from '../../src/lib/syncRecoveryState';

const now = '2026-09-21T00:00:00.000Z';

function subject(id: string): SubjectRecord {
  return { id, name: id, parentId: null, createdAt: now, updatedAt: now, syncState: 'error', syncError: 'failed' };
}

function resource(id: string, versionId = `${id}-version`): ResourceRecord {
  return { id, subjectId: 'subject', title: id, kind: 'pdf', currentVersionId: versionId, status: 'ready', extractionError: null, createdAt: now, updatedAt: now, syncState: 'error', syncError: 'failed' };
}

function attempt(type: OutboxRecord['type'], entityId: string, lastError: string | null, nextAttemptAt: number): OutboxRecord {
  return { id: `${type}-${entityId}`, type, entityId, attempts: 1, nextAttemptAt, lastError, createdAt: now };
}

describe('classifySyncRecoveryState', () => {
  it('keeps terminal timestamps recoverable until an error is recorded', () => {
    const subjects = [subject('recoverable-subject'), subject('blocked-subject')];
    const resources = [resource('recoverable-resource'), resource('blocked-resource')];
    const outbox = [
      attempt('subject.upsert', 'recoverable-subject', null, Number.MAX_SAFE_INTEGER),
      attempt('subject.upsert', 'blocked-subject', 'permission denied', Number.MAX_SAFE_INTEGER),
      attempt('resource.sync', 'recoverable-resource', null, Number.MAX_SAFE_INTEGER),
      attempt('resource.sync', 'blocked-resource', 'permission denied', Number.MAX_SAFE_INTEGER),
    ];

    const state = classifySyncRecoveryState(subjects, resources, [], outbox);

    expect(state.recoverableSubjects.map(({ id }) => id)).toEqual(['recoverable-subject']);
    expect(state.blockedSubjects.map(({ id }) => id)).toEqual(['blocked-subject']);
    expect(state.recoverableResources.map(({ id }) => id)).toEqual(['recoverable-resource']);
    expect(state.blockedResources.map(({ id }) => id)).toEqual(['blocked-resource']);
  });

  it('keeps missing outbox work recoverable so it can be rebuilt', () => {
    const state = classifySyncRecoveryState([subject('subject')], [resource('resource')], [], []);

    expect(state.recoverableSubjects.map(({ id }) => id)).toEqual(['subject']);
    expect(state.recoverableResources.map(({ id }) => id)).toEqual(['resource']);
    expect(state.blockedSubjects).toEqual([]);
    expect(state.blockedResources).toEqual([]);
  });

  it('routes multipart resource failures only through file reselection recovery', () => {
    const failedResource = resource('resource', 'version');
    const multipart: MultipartUploadRecord = {
      versionId: 'version',
      resourceId: 'resource',
      fileName: 'large.pdf',
      size: 100,
      lastModified: 0,
      sha256: 'hash',
      uploadId: 'upload',
      partSize: 10,
      parts: [],
      status: 'error',
      error: 'interrupted',
      updatedAt: now,
    };

    const state = classifySyncRecoveryState(
      [],
      [failedResource],
      [multipart],
      [attempt('resource.sync', 'resource', 'failed', Number.MAX_SAFE_INTEGER)],
    );

    expect(state.recoverableResources).toEqual([]);
    expect(state.blockedResources).toEqual([]);
    expect(state.multipartSessions).toEqual([multipart]);
  });
});

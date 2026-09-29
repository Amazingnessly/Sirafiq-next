export const PRODUCTION_BRANCH = 'main';

export const PRODUCTION_STORAGE = Object.freeze({
  kind: 'production',
  databaseName: 'sirafiq-next-db',
  bucketName: 'sirafiq-next-files',
});

export const PREVIEW_STORAGE = Object.freeze({
  kind: 'preview',
  databaseName: 'sirafiq-next-preview-db',
  bucketName: 'sirafiq-next-preview-files',
});

export function selectCloudflareBuildStorage(env = process.env) {
  const workersBuild = env.WORKERS_CI === '1';
  const branch = env.WORKERS_CI_BRANCH?.trim();
  const productionBranch = env.SIRAFIQ_PRODUCTION_BRANCH?.trim() || PRODUCTION_BRANCH;

  if (workersBuild && branch && branch !== productionBranch) {
    return PREVIEW_STORAGE;
  }

  return PRODUCTION_STORAGE;
}

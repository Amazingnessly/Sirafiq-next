export type BuildIdentity = {
  version: string;
  sha: string;
  shortSha: string;
  branch: string;
  isLocal: boolean;
};

const sha = __SIRAFIQ_BUILD_SHA__;

export const buildIdentity: BuildIdentity = {
  version: __SIRAFIQ_VERSION__,
  sha,
  shortSha: sha === 'local' ? 'local' : sha.slice(0, 8),
  branch: __SIRAFIQ_BUILD_BRANCH__,
  isLocal: sha === 'local',
};

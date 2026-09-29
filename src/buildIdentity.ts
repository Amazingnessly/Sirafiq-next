export type BuildIdentity = {
  version: string;
  sha: string;
  shortSha: string;
  branch: string;
  isLocal: boolean;
};

export const buildIdentity: BuildIdentity = {
  version: '0.1.0',
  sha: 'local',
  shortSha: 'local',
  branch: 'local',
  isLocal: true,
};

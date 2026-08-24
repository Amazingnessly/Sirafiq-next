import { readFile, writeFile } from 'node:fs/promises';

const packageUrl = new URL('../package.json', import.meta.url);
const outputUrl = new URL('../src/buildIdentity.ts', import.meta.url);
const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));

const rawSha = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'local';
const sha = /^[0-9a-f]{7,64}$/i.test(rawSha) ? rawSha.toLowerCase() : 'local';
const rawBranch = process.env.WORKERS_CI_BRANCH ?? process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? 'local';
const branch = String(rawBranch).trim().slice(0, 160) || 'local';
const version = String(pkg.version ?? '0.0.0');
const shortSha = sha === 'local' ? 'local' : sha.slice(0, 8);

const source = `export type BuildIdentity = {\n  version: string;\n  sha: string;\n  shortSha: string;\n  branch: string;\n  isLocal: boolean;\n};\n\nexport const buildIdentity: BuildIdentity = {\n  version: ${JSON.stringify(version)},\n  sha: ${JSON.stringify(sha)},\n  shortSha: ${JSON.stringify(shortSha)},\n  branch: ${JSON.stringify(branch)},\n  isLocal: ${sha === 'local'},\n};\n`;

await writeFile(outputUrl, source, 'utf8');
console.log(`Sirāfiq build identity: v${version} · ${shortSha} · ${branch}`);

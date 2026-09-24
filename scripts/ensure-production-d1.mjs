import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { selectCloudflareBuildStorage } from './cloudflare-build-storage.mjs';

const configPath = 'wrangler.jsonc';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const storage = selectCloudflareBuildStorage();

function runWrangler(args) {
  return execFileSync(npx, ['wrangler', ...args], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

const output = runWrangler(['d1', 'list', '--json']);
const databases = JSON.parse(output);
if (!Array.isArray(databases)) {
  throw new Error('Wrangler returned an unexpected D1 list payload.');
}

const database = databases.find((item) => item.name === storage.databaseName);
const databaseId = database?.uuid ?? database?.id;
if (!databaseId) {
  const label = storage.kind === 'production' ? 'Production' : 'Preview';
  throw new Error(
    `${label} D1 database ${storage.databaseName} was not found. Refusing to create storage from this build path.`,
  );
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const existingD1Binding = (config.d1_databases ?? []).find(
  (binding) => binding.binding === 'DB',
) ?? {};
const existingR2Binding = (config.r2_buckets ?? []).find(
  (binding) => binding.binding === 'FILES',
) ?? {};

config.d1_databases = [
  {
    ...existingD1Binding,
    binding: 'DB',
    database_name: storage.databaseName,
    database_id: databaseId,
    migrations_dir: existingD1Binding.migrations_dir ?? 'migrations',
  },
];

config.r2_buckets = [
  {
    ...existingR2Binding,
    binding: 'FILES',
    bucket_name: storage.bucketName,
  },
];

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  `${storage.kind === 'production' ? 'Production' : 'Preview'} storage bindings prepared for ${storage.databaseName} and ${storage.bucketName}.`,
);

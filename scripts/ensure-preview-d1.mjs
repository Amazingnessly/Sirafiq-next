import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const databaseName = 'sirafiq-next-preview-db';
const bucketName = 'sirafiq-next-preview-files';
const configPath = 'wrangler.jsonc';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function runWrangler(args, capture = true) {
  return execFileSync(npx, ['wrangler', ...args], {
    encoding: 'utf8',
    env: process.env,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

function listDatabases() {
  const output = runWrangler(['d1', 'list', '--json']);
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) {
    throw new Error('Wrangler returned an unexpected D1 list payload.');
  }
  return parsed;
}

function previewBucketExists() {
  const output = runWrangler(['r2', 'bucket', 'list']);
  const escaped = bucketName.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|\\s)' + escaped + '(\\s|$)', 'm').test(output);
}

let database = listDatabases().find((item) => item.name === databaseName);

if (!database) {
  console.log('Creating preview D1 database: ' + databaseName);
  runWrangler(['d1', 'create', databaseName], false);
  database = listDatabases().find((item) => item.name === databaseName);
}

const databaseId = database?.uuid ?? database?.id;
if (!databaseId) {
  throw new Error('Could not resolve the D1 database id for ' + databaseName + '.');
}

if (!previewBucketExists()) {
  console.log('Creating preview R2 bucket: ' + bucketName);
  runWrangler(['r2', 'bucket', 'create', bucketName], false);
  if (!previewBucketExists()) {
    throw new Error('Could not create or resolve the preview R2 bucket ' + bucketName + '.');
  }
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.env ??= {};
config.env.preview ??= {};

const existingD1Binding = (config.env.preview.d1_databases ?? []).find(
  (binding) => binding.binding === 'DB',
) ?? {};
const existingR2Binding = (config.env.preview.r2_buckets ?? []).find(
  (binding) => binding.binding === 'FILES',
) ?? {};

config.env.preview.d1_databases = [
  {
    ...existingD1Binding,
    binding: 'DB',
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: existingD1Binding.migrations_dir ?? 'migrations',
  },
];
config.env.preview.r2_buckets = [
  {
    ...existingR2Binding,
    binding: 'FILES',
    bucket_name: bucketName,
  },
];

writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('Preview storage bindings prepared for ' + databaseName + ' and ' + bucketName + '.');

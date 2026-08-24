import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const databaseName = 'sirafiq-next-preview-db';
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

let database = listDatabases().find((item) => item.name === databaseName);

if (!database) {
  console.log(`Creating preview D1 database: ${databaseName}`);
  runWrangler(['d1', 'create', databaseName], false);
  database = listDatabases().find((item) => item.name === databaseName);
}

const databaseId = database?.uuid ?? database?.id;
if (!databaseId) {
  throw new Error(`Could not resolve the D1 database id for ${databaseName}.`);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.env ??= {};
config.env.preview ??= {};

const existingBinding = (config.env.preview.d1_databases ?? []).find(
  (binding) => binding.binding === 'DB',
) ?? {};

config.env.preview.d1_databases = [
  {
    ...existingBinding,
    binding: 'DB',
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: existingBinding.migrations_dir ?? 'migrations',
  },
];

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Preview D1 binding prepared for ${databaseName}.`);

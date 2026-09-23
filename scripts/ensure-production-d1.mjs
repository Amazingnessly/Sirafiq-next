import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const databaseName = 'sirafiq-next-db';
const configPath = 'wrangler.jsonc';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

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

const database = databases.find((item) => item.name === databaseName);
const databaseId = database?.uuid ?? database?.id;
if (!databaseId) {
  throw new Error(
    `Production D1 database ${databaseName} was not found. Refusing to create production storage automatically.`,
  );
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const existingBinding = (config.d1_databases ?? []).find(
  (binding) => binding.binding === 'DB',
) ?? {};

config.d1_databases = [
  {
    ...existingBinding,
    binding: 'DB',
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: existingBinding.migrations_dir ?? 'migrations',
  },
];

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Production D1 binding prepared for ${databaseName}.`);

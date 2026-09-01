// Applies supabase/migrations/*.sql in filename order, once each, tracked in
// a schema_migrations table. Plain Node like the rest of scripts/ — reads
// DATABASE_URL from the environment or .env.
//
//   node scripts/db-migrate.js

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL && existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (env or .env).');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });

try {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;

  const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const dir = join(root, 'supabase', 'migrations');
  const pending = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && !applied.has(f))
    .sort();

  if (pending.length === 0) {
    console.log('Nothing to apply — schema is up to date.');
  }
  for (const name of pending) {
    const body = readFileSync(join(dir, name), 'utf8');
    // simple() allows the multi-statement files through the pooler.
    await sql.unsafe(body).simple();
    await sql`insert into schema_migrations (name) values (${name})`;
    console.log(`applied ${name}`);
  }
} finally {
  await sql.end();
}

// Direct Postgres access for the server functions — the browser never talks
// to the database (every ladder table has RLS enabled with zero policies, so
// even Supabase's publishable key reads nothing; the server connects as the
// postgres role via DATABASE_URL and bypasses RLS entirely).
//
// DATABASE_URL should be Supabase's shared transaction-mode pooler (port
// 6543): it's IPv4-friendly and built for many short serverless connections.
// Transaction mode can't hold prepared statements, hence prepare: false.

import postgres from 'postgres';

let client: ReturnType<typeof postgres> | null = null;

export function sql(): ReturnType<typeof postgres> {
  if (!client) {
    // POSTGRES_URL is what the Supabase↔Vercel integration injects (it is
    // the same pooled connection); DATABASE_URL wins if both are set.
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL (or POSTGRES_URL) must be set (see .env.example)');
    client = postgres(url, { prepare: false, ssl: 'require', max: 4 });
  }
  return client;
}

// The canonical public origin, e.g. https://sanctuarydb.example. Steam's
// OpenID realm/return_to are derived from it, so sign-in only works on this
// origin (set it to http://localhost:5173 for local dev).
export function siteUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) throw new Error('SITE_URL must be set (see .env.example)');
  return url.replace(/\/$/, '');
}

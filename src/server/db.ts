// Direct Postgres access for the server functions — the browser never talks
// to the database (every ladder table has RLS enabled with zero policies, so
// even Supabase's publishable key reads nothing; the server connects as the
// postgres role via DATABASE_URL and bypasses RLS entirely).
//
// DATABASE_URL should be Supabase's shared transaction-mode pooler (port
// 6543): it's IPv4-friendly and built for many short serverless connections.
// Transaction mode can't hold prepared statements, hence prepare: false.
//
// Serverless wrinkle: a warm instance keeps this client (and its sockets)
// between invocations, frozen in between. A connection the pooler dropped
// while we were frozen looks open from here and a query on it never
// answers — and with a shared pool, one dead socket stalls everything that
// queues behind it, which the site sees as "every click hangs for a minute,
// then it all works again". So every query runs under a watchdog: past the
// limit it fails fast and the whole client is thrown away, so the next call
// starts on fresh sockets.

import postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

const QUERY_TIMEOUT_MS = 8000;

let client: Sql | null = null;

function connect(): Sql {
  // POSTGRES_URL is what the Supabase↔Vercel integration injects (it is
  // the same pooled connection); DATABASE_URL wins if both are set.
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL (or POSTGRES_URL) must be set (see .env.example)');
  return postgres(url, {
    prepare: false,
    ssl: 'require',
    max: 4,
    // Idle sockets go before the pooler is likely to drop them; none lives
    // past half an hour; connecting is bounded too.
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
  });
}

function raw(): Sql {
  client ??= connect();
  return client;
}

// Drops the client so the next query reconnects. The old one is closed in
// the background; an in-flight query on a dead socket just never resolves.
function reset(why: string): void {
  const old = client;
  client = null;
  console.warn(`[db] resetting connections: ${why}`);
  if (old) void old.end({ timeout: 1 }).catch(() => {});
}

const looksLikeDeadConnection = (e: unknown): boolean => {
  const code = (e as { code?: string } | null)?.code ?? '';
  return [
    'CONNECTION_CLOSED',
    'CONNECTION_ENDED',
    'CONNECTION_DESTROYED',
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
  ].includes(code);
};

// Exported for the unit test only.
export function guard<T>(pending: PromiseLike<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reset(`query exceeded ${QUERY_TIMEOUT_MS} ms (${label})`);
      reject(new Error('The database did not answer in time — try again.'));
    }, QUERY_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve(pending), watchdog])
    .catch((e: unknown) => {
      if (looksLikeDeadConnection(e)) reset(`${(e as { code?: string }).code} (${label})`);
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

const preview = (strings: TemplateStringsArray | string): string =>
  (typeof strings === 'string' ? strings : strings.join('?')).replace(/\s+/g, ' ').trim().slice(0, 60);

// The guarded client: a tagged template like the real thing (and the same
// helpers the code uses — sql(list) for `in`, .array, .unsafe), with every
// query under the watchdog. Typed as the real client so call sites are
// unchanged.
function guarded(this: unknown, ...args: unknown[]): unknown {
  const c = raw();
  const first = args[0] as { raw?: unknown } | undefined;
  if (first && typeof first === 'object' && 'raw' in first) {
    // Tagged template → a query.
    return guard(
      (c as unknown as (...a: unknown[]) => PromiseLike<unknown>)(...args),
      preview(first as unknown as TemplateStringsArray),
    );
  }
  // Helper call (sql(list), sql('column')) → a fragment, not a query.
  return (c as unknown as (...a: unknown[]) => unknown)(...args);
}
guarded.array = (...a: unknown[]) => (raw().array as (...x: unknown[]) => unknown)(...a);
guarded.unsafe = (query: string, params?: unknown[]) =>
  guard((raw().unsafe as (q: string, p?: unknown[]) => PromiseLike<unknown>)(query, params), preview(query));
guarded.end = (opts?: { timeout?: number }) => {
  const old = client;
  client = null;
  return old ? old.end(opts) : Promise.resolve();
};

export function sql(): Sql {
  return guarded as unknown as Sql;
}

// The canonical public origin, e.g. https://sanctuarydb.example. Steam's
// OpenID realm/return_to are derived from it, so sign-in only works on this
// origin (set it to http://localhost:5173 for local dev).
export function siteUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) throw new Error('SITE_URL must be set (see .env.example)');
  return url.replace(/\/$/, '');
}

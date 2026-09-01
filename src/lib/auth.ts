// Client-side "who am I" cache, same module-level promise pattern as data.ts
// and maps.ts. The readable sdb_signed_in cookie (set alongside the httpOnly
// session by src/server/session.ts) short-circuits the whole thing: with no
// hint there is no session, so the static site and anonymous visitors make
// zero requests — which also keeps the backend-less e2e build free of failed
// -request console noise.

import { getMe } from '../server/auth-fns';
import type { Me } from './ladder-types';

// Mirrors SIGNED_IN_HINT in src/server/session.ts (not imported — that module
// must stay out of the client bundle).
const HINT_COOKIE = 'sdb_signed_in';

export const hasSessionHint = (): boolean =>
  typeof document !== 'undefined' && document.cookie.split('; ').some((c) => c.startsWith(`${HINT_COOKIE}=`));

let cache: Promise<Me | null> | null = null;

export function loadMe(): Promise<Me | null> {
  cache ??= hasSessionHint() ? getMe().catch(() => null) : Promise.resolve(null);
  return cache;
}

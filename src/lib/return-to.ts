// Where to land after Steam sign-in: the page the player was on, carried as
// a `next` query param through the login route and the OpenID return_to
// (which Steam echoes back and signs, so nothing needs storing server-side).
//
// Shared by the client (building the sign-in href) and the server (checking
// what came back), so it must stay free of server-only imports.

export const DEFAULT_RETURN_TO = '/ladder';

// Only a same-site path is allowed through: anything that could leave the
// origin (absolute URLs, protocol-relative `//`, backslash tricks) or bounce
// straight back into an /api route falls back to the ladder.
export function safeReturnTo(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\\\r\n]/.test(next)) {
    return DEFAULT_RETURN_TO;
  }
  if (next === '/api' || next.startsWith('/api/')) return DEFAULT_RETURN_TO;
  return next;
}

// href for the "Sign in through Steam" links: returns the player to the
// current page (path + query) once they're signed in.
export function signInHref(): string {
  if (typeof window === 'undefined') return '/api/auth/steam';
  const here = safeReturnTo(window.location.pathname + window.location.search);
  return `/api/auth/steam?next=${encodeURIComponent(here)}`;
}

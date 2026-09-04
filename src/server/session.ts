// Stateless sessions: a signed JWT in an httpOnly cookie. No sessions table —
// there's nothing to revoke that the per-request ban check doesn't already
// cover, and the ladder's threat model is "friends being cheeky", not banks.
//
// A second, readable cookie (SIGNED_IN_HINT) mirrors the session's existence
// so the client can skip calling getMe when there's obviously no session —
// which also keeps the static e2e build free of failed-request console noise.

import { SignJWT, jwtVerify } from 'jose';
import { getCookie } from '@tanstack/react-start/server';

export const SESSION_COOKIE = 'sdb_session';
export const SIGNED_IN_HINT = 'sdb_signed_in';
const MAX_AGE_S = 60 * 60 * 24 * 30;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 chars');
  }
  return new TextEncoder().encode(s);
}

export interface Session {
  playerId: string;
  steamId: string;
}

// Set-Cookie header values for the auth routes, which build their redirect
// Responses by hand. `Secure` is fine on http://localhost — browsers treat it
// as a secure context.
export async function sessionCookies(session: Session): Promise<string[]> {
  const jwt = await new SignJWT({ steamId: session.steamId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.playerId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
  return [
    `${SESSION_COOKIE}=${jwt}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`,
    `${SIGNED_IN_HINT}=1; Path=/; Max-Age=${MAX_AGE_S}; Secure; SameSite=Lax`,
  ];
}

// Where to land after Steam sign-in. The login route stashes the page the
// player came from here and the callback reads it back — a cookie rather
// than a query param on return_to, so it survives whatever Steam does to
// that URL. Scoped to the auth routes and short-lived; Lax is enough since
// the callback is a top-level GET navigation from Steam.
const RETURN_TO_COOKIE = 'sdb_return_to';
const RETURN_TO_MAX_AGE_S = 60 * 10;

export function returnToCookie(path: string): string {
  return `${RETURN_TO_COOKIE}=${encodeURIComponent(path)}; Path=/api/auth/steam; Max-Age=${RETURN_TO_MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearReturnToCookie(): string {
  return `${RETURN_TO_COOKIE}=; Path=/api/auth/steam; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

// Raw (unvalidated) value from a request's Cookie header, or null.
export function readReturnToCookie(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === RETURN_TO_COOKIE) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function clearSessionCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    `${SIGNED_IN_HINT}=; Path=/; Max-Age=0; Secure; SameSite=Lax`,
  ];
}

export async function readSession(): Promise<Session | null> {
  const jwt = getCookie(SESSION_COOKIE);
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, secret());
    if (typeof payload.sub !== 'string' || typeof payload.steamId !== 'string') return null;
    return { playerId: payload.sub, steamId: payload.steamId };
  } catch {
    return null; // expired, tampered, or signed with an old secret — all just "not signed in"
  }
}

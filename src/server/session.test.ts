import { describe, expect, it } from 'vitest';
import { clearReturnToCookie, readReturnToCookie, returnToCookie } from './session';

const requestWith = (cookie: string) =>
  new Request('http://x/api/auth/steam/callback', { headers: { cookie } });

describe('return-to cookie', () => {
  it('round-trips a path with a query string', () => {
    const [pair] = returnToCookie('/maps?m=x&q=y').split(';');
    expect(readReturnToCookie(requestWith(`other=1; ${pair}; sdb_signed_in=1`))).toBe('/maps?m=x&q=y');
  });

  it('is scoped to the auth routes and short-lived', () => {
    expect(returnToCookie('/maps')).toMatch(/Path=\/api\/auth\/steam;/);
    expect(returnToCookie('/maps')).toMatch(/Max-Age=600;/);
    expect(clearReturnToCookie()).toMatch(/Max-Age=0;/);
  });

  it('returns null when absent or malformed', () => {
    expect(readReturnToCookie(requestWith('sdb_signed_in=1'))).toBeNull();
    expect(readReturnToCookie(requestWith('sdb_return_to=%E0%A4%A'))).toBeNull();
  });
});

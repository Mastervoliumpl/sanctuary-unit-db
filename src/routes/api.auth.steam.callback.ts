// Steam sends the player back here after sign-in. Verify the assertion with
// Steam itself, upsert the player row (never touching rating/stats — upsert
// only writes the columns given), set the session cookies and land back on
// the page the player signed in from (the cookie the login route set), or
// the ladder if that's missing or not a same-site path.

import { createFileRoute } from '@tanstack/react-router';
import { siteUrl, sql } from '../server/db';
import { clearReturnToCookie, readReturnToCookie, sessionCookies } from '../server/session';
import { fetchPersona, verifySteamCallback } from '../server/steam';
import { safeReturnTo } from '../lib/return-to';

export const Route = createFileRoute('/api/auth/steam/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const steamId = await verifySteamCallback(new URL(request.url));
        if (!steamId) return new Response('Steam sign-in failed.', { status: 403 });

        const persona = await fetchPersona(steamId);
        const [player] = await sql()<{ id: string; banned_at: Date | null }[]>`
          insert into players (steam_id, persona_name, avatar_url)
          values (${steamId}, ${persona.personaName}, ${persona.avatarUrl})
          on conflict (steam_id) do update set
            persona_name = excluded.persona_name,
            avatar_url = excluded.avatar_url,
            last_seen_at = now()
          returning id, banned_at`;
        if (!player) return new Response('Sign-in failed.', { status: 500 });
        if (player.banned_at) return new Response('This account is banned from the ladder.', { status: 403 });

        const headers = new Headers({
          Location: `${siteUrl()}${safeReturnTo(readReturnToCookie(request))}`,
        });
        for (const cookie of await sessionCookies({ playerId: player.id, steamId })) {
          headers.append('Set-Cookie', cookie);
        }
        headers.append('Set-Cookie', clearReturnToCookie());
        return new Response(null, { status: 302, headers });
      },
    },
  },
});

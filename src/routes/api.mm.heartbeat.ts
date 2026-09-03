// The mod's 5-second heartbeat, which doubles as its poll. It records what
// the game is doing (only `menu` is launchable), runs the lazy sweep so
// countdowns and timeouts fire even when nobody has the site open, and
// answers with the player's current match.
//
// This is a capability signal, not a gate: queueing happens on the site and
// works with no mod at all. The heartbeat only decides whether a pair gets
// the `auto` flow.
//
// Three round trips: the token, the presence write, then sweep + queued +
// match. The mod treats a heartbeat older than 15 s as "not launchable", so
// this has to stay fast — anything over 1.5 s is logged.
//
//   POST /api/mm/heartbeat  { state, gameVersion?, modVersion? }
//   → { queued, match }

import { createFileRoute } from '@tanstack/react-router';
import { sql } from '../server/db';
import { authenticate, bad, currentModMatch, json, logSlow, readJson } from '../server/mm';
import { isModState } from '../lib/mm';

const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null);

export const Route = createFileRoute('/api/mm/heartbeat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const me = await authenticate(request);
        if (!me) return bad(401, 'Session expired or unknown — mint a new one.');

        const body = await readJson(request);
        if (!body) return bad(400, 'Body is not JSON.');
        if (!isModState(body.state)) return bad(400, 'state must be menu, lobby, loading or ingame.');

        // Presence first, on its own, so the sweep that follows sees this
        // heartbeat when a countdown is hitting zero right now.
        await sql()`
          insert into mod_presence (player_id, state, game_version, mod_version, seen_at)
          values (${me.playerId}, ${body.state}, ${str(body.gameVersion, 40)}, ${str(body.modVersion, 40)}, now())
          on conflict (player_id) do update set
            state = excluded.state, game_version = excluded.game_version,
            mod_version = excluded.mod_version, seen_at = now()`;

        const [{ queued }] = await sql()<{ queued: boolean }[]>`
          select sweep_all(), exists (
            select 1 from queue_entries
            where player_id = ${me.playerId} and heartbeat_at > now() - interval '90 seconds'
          ) as queued`;

        const match = await currentModMatch(me.playerId, me.steamId);
        logSlow('heartbeat', startedAt, `${me.personaName} ${body.state}`);
        return json(200, { queued, match });
      },
    },
  },
});

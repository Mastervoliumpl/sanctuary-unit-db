// Progress events from both mods, so the match page can show how far the
// launch has got and the sweep can time it out cleanly. Two events change
// the match themselves: `failed` (with `map missing` treated like a player
// who stopped being launchable — back to manual, not a hard failure) and
// `left` before the game started.
//
//   POST /api/mm/match/{id}/event  { type, detail? }  → the match object

import { createFileRoute } from '@tanstack/react-router';
import { sql } from '../server/db';
import {
  authenticate,
  bad,
  isParticipant,
  isUuid,
  json,
  loadModMatch,
  readJson,
  sweepAll,
} from '../server/mm';
import { isMmEventType } from '../lib/mm';

export const Route = createFileRoute('/api/mm/match/$id/event')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const me = await authenticate(request);
        if (!me) return bad(401, 'Session expired or unknown — mint a new one.');
        if (!isUuid(params.id)) return bad(404, 'No such match.');

        const body = await readJson(request);
        if (!body) return bad(400, 'Body is not JSON.');
        if (!isMmEventType(body.type)) return bad(400, 'Unknown event type.');
        const detail = typeof body.detail === 'string' ? body.detail.slice(0, 200) : null;

        if (!(await isParticipant(params.id, me.playerId))) return bad(404, 'No such match.');

        await sql()`
          insert into mm_events (match_id, player_id, type, detail)
          values (${params.id}, ${me.playerId}, ${body.type}, ${detail})`;

        if (body.type === 'failed') {
          if (detail && /map missing/i.test(detail)) {
            await sql()`
              select mm_fallback_manual(${params.id},
                ${`${me.personaName}'s game is missing the map, so host manually`})`;
          } else {
            await sql()`
              select mm_fail(${params.id},
                ${detail ? `${me.personaName}'s game failed: ${detail}` : `${me.personaName}'s game failed to launch`})`;
          }
        } else if (body.type === 'left') {
          // Only bites before the game is running (mm_fail checks the status).
          await sql()`select mm_fail(${params.id}, ${`${me.personaName} left the lobby`})`;
        }

        await sweepAll();
        return json(200, await loadModMatch(params.id, me.steamId));
      },
    },
  },
});

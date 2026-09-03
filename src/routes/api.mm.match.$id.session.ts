// Session handoff: once the host's mod has created the lobby it posts the
// game-server id here; the joiner's mod sees it on its next heartbeat and
// joins. Host only, and only while the match is in `launch`.
//
//   POST /api/mm/match/{id}/session  { sessionId }  → the match object

import { createFileRoute } from '@tanstack/react-router';
import { sql } from '../server/db';
import { authenticate, bad, isUuid, json, loadModMatch, readJson, sweepAll } from '../server/mm';

export const Route = createFileRoute('/api/mm/match/$id/session')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const me = await authenticate(request);
        if (!me) return bad(401, 'Session expired or unknown — mint a new one.');
        if (!isUuid(params.id)) return bad(404, 'No such match.');

        const body = await readJson(request);
        if (!body) return bad(400, 'Body is not JSON.');
        const sessionId = typeof body.sessionId === 'number' ? String(body.sessionId) : body.sessionId;
        if (typeof sessionId !== 'string' || !/^\d{1,20}$/.test(sessionId)) {
          return bad(400, 'sessionId must be the game-server id as digits.');
        }

        await sweepAll();
        const match = await loadModMatch(params.id, me.steamId);
        if (!match) return bad(404, 'No such match.');
        if (match.host !== me.steamId) return bad(403, 'Only the host posts the session id.');
        if (match.status !== 'launch') return bad(409, `The match is ${match.status}, not launching.`);

        await sql()`
          update matches set session_id = ${sessionId}, session_at = now()
          where id = ${params.id} and mm_status = 'launch' and session_id is null`;

        return json(200, await loadModMatch(params.id, me.steamId));
      },
    },
  },
});

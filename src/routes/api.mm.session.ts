// The mod's sign-in: one Steam web-API ticket (verified with Steam exactly as
// /api/report does) exchanged for a short-lived bearer token, so the 5 s
// heartbeat doesn't cost a Steam round-trip each time. The mod re-mints on
// any 401.
//
//   POST /api/mm/session  { ticket, identity? }
//   → { token, steamId, name, expiresAt }

import { createFileRoute } from '@tanstack/react-router';
import { bad, json, mintSession, readJson } from '../server/mm';
import { TICKET_IDENTITY } from '../lib/mm';

export const Route = createFileRoute('/api/mm/session')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson(request);
        if (!body) return bad(400, 'Body is not JSON.');
        if (typeof body.ticket !== 'string') return bad(400, 'ticket required.');
        // The reporter mints with one identity for everything; anything else
        // would fail Steam's check anyway, so say so up front.
        if (body.identity !== undefined && body.identity !== TICKET_IDENTITY) {
          return bad(400, `identity must be ${TICKET_IDENTITY}.`);
        }

        const session = await mintSession(body.ticket);
        if (!session) return bad(403, 'Steam did not vouch for this ticket.');
        return json(200, {
          token: session.token,
          steamId: session.player.steamId,
          name: session.player.personaName,
          expiresAt: session.expiresAt.toISOString(),
        });
      },
    },
  },
});

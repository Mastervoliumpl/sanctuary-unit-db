// The auto-reporter's entry point: the LadderReporter mod (in the
// sanctuary-hud repo) POSTs a result here when a ranked-shaped game ends,
// authenticated by a Steam web-API ticket minted from the game's own session
// — Steam itself confirms which account sent it, so a report is exactly as
// trustworthy as that player being signed in.
//
// Trust rules on top of the ticket:
// - the reporter conceding their own LOSS applies immediately (claiming your
//   own defeat is credible);
// - the reporter claiming their own WIN opens the usual 15-minute
//   auto-confirm window, exactly like a manual report — unless the opponent's
//   client corroborates, which applies it on the spot;
// - contradicting reports freeze the match as disputed.
//
// A report for a game that isn't an open ladder match between the two named
// players is answered 404 and ignored — playing unranked is invisible here.

import { createFileRoute } from '@tanstack/react-router';
import { sql } from '../server/db';
import { verifyWebApiTicket } from '../server/steam';

const AUTO_CONFIRM_MINUTES = 15;

interface ReportBody {
  ticket: string;
  identity: string;
  mapName?: string;
  participants: { steamId: string }[];
  winnerSteamIds: string[];
}

const bad = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ok = (outcome: string) =>
  new Response(JSON.stringify({ outcome }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

// Returns the parsed body or the name of the first check that failed — the
// mod logs the server's answer, so a precise reason debugs a field problem
// from the game side alone.
function parseBody(raw: unknown): ReportBody | string {
  const d = raw as ReportBody | null;
  if (typeof d?.ticket !== 'string') return 'ticket';
  if (typeof d.identity !== 'string') return 'identity';
  if (!Array.isArray(d.participants) || !Array.isArray(d.winnerSteamIds)) return 'arrays';
  const ids = d.participants.map((p) => p?.steamId);
  if (ids.length !== 2) return 'participant count';
  if (!ids.every((s) => typeof s === 'string' && /^\d{17}$/.test(s))) return 'participant steamIds';
  if (ids[0] === ids[1]) return 'duplicate participants';
  if (!d.winnerSteamIds.every((s) => typeof s === 'string' && /^\d{17}$/.test(s))) return 'winnerSteamIds';
  return d;
}

export const Route = createFileRoute('/api/report')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return bad(400, 'Body is not JSON.');
        }
        const body = parseBody(raw);
        if (typeof body === 'string') return bad(400, `Malformed report: ${body}.`);

        const reporterSteamId = await verifyWebApiTicket(body.ticket, body.identity);
        if (!reporterSteamId) return bad(403, 'Steam did not vouch for this ticket.');

        const steamIds = body.participants.map((p) => p.steamId);
        if (!steamIds.includes(reporterSteamId)) {
          return bad(403, 'The ticket owner is not one of the reported players.');
        }
        const winners = body.winnerSteamIds.filter((s) => steamIds.includes(s));
        if (winners.length !== 1) return bad(400, 'Expected exactly one winning participant.');
        const winnerSteamId = winners[0];

        // The open 1v1 match between exactly these two players, if any.
        const [match] = await sql()<
          {
            match_id: string;
            status: string;
            reported_by: string | null;
            reported_winner_team: number | null;
            winner_team: number;
            reporter_player_id: string;
          }[]
        >`
          select m.id as match_id, m.status, m.reported_by, m.reported_winner_team,
                 mpw.team as winner_team, reporter.id as reporter_player_id
          from matches m
          join match_participants mpa on mpa.match_id = m.id
          join players pa on pa.id = mpa.player_id and pa.steam_id = ${steamIds[0]}
          join match_participants mpb on mpb.match_id = m.id
          join players pb on pb.id = mpb.player_id and pb.steam_id = ${steamIds[1]}
          join match_participants mpw on mpw.match_id = m.id
          join players pw on pw.id = mpw.player_id and pw.steam_id = ${winnerSteamId}
          join players reporter on reporter.steam_id = ${reporterSteamId}
          where m.status in ('in_progress', 'reported')
          order by m.created_at desc
          limit 1`;
        if (!match) return bad(404, 'No open ladder match between these players.');

        const reporterWon = reporterSteamId === winnerSteamId;

        if (match.status === 'in_progress') {
          const updated = await sql()`
            update matches set
              status = 'reported',
              reported_by = ${match.reporter_player_id},
              reported_winner_team = ${match.winner_team},
              auto_confirm_at = now() + interval '1 minute' * ${AUTO_CONFIRM_MINUTES}
            where id = ${match.match_id} and status = 'in_progress'
            returning id`;
          if (updated.length === 0) return bad(409, 'The match changed while reporting — retry.');
          if (reporterWon) return ok('reported'); // opponent confirms, or the window lapses
          await sql()`select apply_match_result(${match.match_id}, ${match.winner_team})`;
          return ok('applied');
        }

        // Already reported (by the opponent's mod or by hand).
        if (match.reported_winner_team === match.winner_team) {
          if (match.reported_by !== match.reporter_player_id) {
            // Both sides agree — no reason to wait out the window.
            await sql()`select apply_match_result(${match.match_id}, ${match.winner_team})`;
            return ok('applied');
          }
          return ok('reported'); // same reporter repeating themselves
        }

        if (match.reported_by !== match.reporter_player_id) {
          await sql()`
            update matches set status = 'disputed'
            where id = ${match.match_id} and status = 'reported'`;
          await sql()`
            insert into disputes (match_id, raised_by, reason)
            values (${match.match_id}, ${match.reporter_player_id},
                    'Auto-reporter contradiction: clients disagreed on the winner.')`;
          return ok('disputed');
        }
        return bad(409, 'Contradicts your own earlier report.');
      },
    },
  },
});

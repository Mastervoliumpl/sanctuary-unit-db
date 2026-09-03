// Match lifecycle: view, cancel, report, confirm, dispute, profiles.
//
// Trust model (manual reporting): any participant reports the result, anyone
// on the OTHER side confirms or disputes, and an unanswered report
// auto-confirms after 15 minutes (swept lazily by finalize_due_matches — no
// cron). Cancelling is free for the first 5 minutes (no-shows); after that it
// takes a request from each side. Disputed matches freeze for an admin.

import { createServerFn } from '@tanstack/react-start';
import { sql } from './db';
import {
  AUTO_CONFIRM_MINUTES,
  CANCEL_WINDOW_MINUTES,
  OPEN_STATES,
  loadMatch,
  loadMmEvents,
  loadParticipants,
  teamOf,
  toView,
  type MatchRow,
  type ParticipantRow,
} from './match-data';
import { requirePlayer } from './player';
import { overallRating } from '../lib/elo';
import type { Mode } from '../lib/ladder-modes';
import type { MatchView, Profile, ProfileMatch, ProfileOpponent, RatingSummary } from '../lib/ladder-types';

// Loads a match the caller is allowed to see, as the caller. Open matches are
// participant-only; finished ones are public record (they're on profiles).
// Invalid uuids throw like missing matches — same "not found" to the client.
async function loadMatchAs(
  matchId: string,
  playerId: string | null,
): Promise<{ match: MatchRow; participants: ParticipantRow[] }> {
  const match = await loadMatch(matchId);
  if (!match) throw new Error('Match not found');
  const participants = await loadParticipants([matchId]);
  const mine = playerId !== null && participants.some((p) => p.player_id === playerId);
  if (OPEN_STATES.includes(match.status) && !mine) throw new Error('Match not found');
  return { match, participants };
}

const view = async (matchId: string, playerId: string | null): Promise<MatchView> => {
  const { match, participants } = await loadMatchAs(matchId, playerId);
  const events = match.mm_mode === 'auto' || match.mm_reason ? await loadMmEvents([matchId]) : [];
  return toView(match, participants, events);
};

// Overdue auto-confirms, plus the auto-launch countdowns and timeouts.
const sweep = () => sql()`select sweep_all()`;

const matchIdInput = (data: unknown): { matchId: string } => {
  const d = data as { matchId?: unknown } | null;
  if (typeof d?.matchId !== 'string' || !/^[0-9a-f-]{36}$/.test(d.matchId)) {
    throw new Error('matchId required');
  }
  return { matchId: d.matchId };
};

export const matchGet = createServerFn({ method: 'POST' })
  .validator(matchIdInput)
  .handler(async ({ data }): Promise<MatchView> => {
    await sweep();
    const me = await requirePlayer().catch(() => null);
    return view(data.matchId, me?.playerId ?? null);
  });

// Free inside the no-show window; afterwards one request from each side.
export const matchCancel = createServerFn({ method: 'POST' })
  .validator(matchIdInput)
  .handler(async ({ data }): Promise<MatchView> => {
    const me = await requirePlayer();
    const { match, participants } = await loadMatchAs(data.matchId, me.playerId);
    if (match.status !== 'in_progress') return view(data.matchId, me.playerId);

    const withinWindow = Date.now() < match.created_at.getTime() + CANCEL_WINDOW_MINUTES * 60_000;
    const otherSideAsked =
      match.cancel_requested_by !== null &&
      teamOf(participants, match.cancel_requested_by) !== teamOf(participants, me.playerId);

    if (withinWindow || otherSideAsked) {
      // The status guard makes concurrent cancel/report races resolve to
      // whichever write lands first; a stale loser just reloads the new state.
      // An auto match's mm lifecycle ends with it (the mod stops launching).
      await sql()`
        update matches set status = 'cancelled', cancelled_by = ${me.playerId},
          mm_status = case when mm_mode = 'auto' then 'cancelled' else mm_status end
        where id = ${data.matchId} and status = 'in_progress'`;
    } else if (match.cancel_requested_by === null) {
      await sql()`
        update matches set cancel_requested_by = ${me.playerId}
        where id = ${data.matchId} and status = 'in_progress'`;
    }
    return view(data.matchId, me.playerId);
  });

export const matchReport = createServerFn({ method: 'POST' })
  .validator((data: unknown): { matchId: string; winnerTeam: number } => {
    const { matchId } = matchIdInput(data);
    const d = data as { winnerTeam?: unknown };
    if (d.winnerTeam !== 1 && d.winnerTeam !== 2) throw new Error('winnerTeam must be 1 or 2');
    return { matchId, winnerTeam: d.winnerTeam };
  })
  .handler(async ({ data }): Promise<MatchView> => {
    const me = await requirePlayer();
    await loadMatchAs(data.matchId, me.playerId);
    await sql()`
      update matches set
        status = 'reported',
        reported_by = ${me.playerId},
        reported_winner_team = ${data.winnerTeam},
        auto_confirm_at = now() + interval '1 minute' * ${AUTO_CONFIRM_MINUTES}
      where id = ${data.matchId} and status = 'in_progress'`;
    return view(data.matchId, me.playerId);
  });

// Only the side that didn't report can confirm or dispute.
const canAnswerReport = (match: MatchRow, participants: ParticipantRow[], playerId: string) =>
  match.status === 'reported' && teamOf(participants, match.reported_by) !== teamOf(participants, playerId);

export const matchConfirm = createServerFn({ method: 'POST' })
  .validator(matchIdInput)
  .handler(async ({ data }): Promise<MatchView> => {
    const me = await requirePlayer();
    const { match, participants } = await loadMatchAs(data.matchId, me.playerId);
    if (canAnswerReport(match, participants, me.playerId)) {
      await sql()`select apply_match_result(${data.matchId}, ${match.reported_winner_team})`;
    }
    return view(data.matchId, me.playerId);
  });

export const matchDispute = createServerFn({ method: 'POST' })
  .validator((data: unknown): { matchId: string; reason: string } => {
    const { matchId } = matchIdInput(data);
    const d = data as { reason?: unknown };
    return { matchId, reason: typeof d.reason === 'string' ? d.reason.slice(0, 500) : '' };
  })
  .handler(async ({ data }): Promise<MatchView> => {
    const me = await requirePlayer();
    const { match, participants } = await loadMatchAs(data.matchId, me.playerId);
    if (canAnswerReport(match, participants, me.playerId)) {
      await sql()`
        update matches set status = 'disputed'
        where id = ${data.matchId} and status = 'reported'`;
      await sql()`
        insert into disputes (match_id, raised_by, reason)
        values (${data.matchId}, ${me.playerId}, ${data.reason})`;
    }
    return view(data.matchId, me.playerId);
  });

export const profileGet = createServerFn({ method: 'POST' })
  .validator((data: unknown): { steamId: string } => {
    const d = data as { steamId?: unknown } | null;
    if (typeof d?.steamId !== 'string' || !/^\d{17}$/.test(d.steamId)) {
      throw new Error('steamId required');
    }
    return { steamId: d.steamId };
  })
  .handler(async ({ data }): Promise<Profile | null> => {
    const [player] = await sql()<
      { id: string; steam_id: string; persona_name: string; avatar_url: string | null }[]
    >`
      select id, steam_id, coalesce(display_name, persona_name) as persona_name, avatar_url
      from players where steam_id = ${data.steamId} and banned_at is null`;
    if (!player) return null;

    const ratingRows = await sql()<
      { mode: Mode; rating: number; games_played: number; wins: number; losses: number }[]
    >`select mode, rating, games_played, wins, losses from player_ratings where player_id = ${player.id}`;
    const ratings: Partial<Record<Mode, RatingSummary>> = {};
    for (const r of ratingRows) {
      ratings[r.mode] = { rating: r.rating, gamesPlayed: r.games_played, wins: r.wins, losses: r.losses };
    }

    const games = await sql()<
      {
        match_id: string;
        mode: Mode;
        outcome: 'win' | 'loss';
        rating_after: number;
        rating_delta: number;
        map_name: string;
        completed_at: Date;
      }[]
    >`
      select mp.match_id, m.mode, mp.outcome, mp.rating_after, mp.rating_delta, m.map_name, m.completed_at
      from match_participants mp
      join matches m on m.id = mp.match_id and m.status = 'completed'
      where mp.player_id = ${player.id}
      order by m.completed_at asc`;

    const opponents = new Map<string, ProfileOpponent[]>();
    if (games.length > 0) {
      const rows = await sql()<{ match_id: string; steam_id: string; persona_name: string }[]>`
        select op.match_id, p.steam_id, coalesce(p.display_name, p.persona_name) as persona_name
        from match_participants op
        join match_participants mine on mine.match_id = op.match_id and mine.player_id = ${player.id}
        join players p on p.id = op.player_id
        where op.team <> mine.team and op.match_id in ${sql()(games.map((g) => g.match_id))}
        order by p.persona_name`;
      for (const r of rows) {
        const list = opponents.get(r.match_id) ?? [];
        list.push({ steamId: r.steam_id, personaName: r.persona_name });
        opponents.set(r.match_id, list);
      }
    }

    const history: ProfileMatch[] = games.map((g) => ({
      matchId: g.match_id,
      mode: g.mode,
      mapName: g.map_name,
      opponents: opponents.get(g.match_id) ?? [],
      outcome: g.outcome,
      ratingAfter: g.rating_after,
      ratingDelta: g.rating_delta,
      completedAt: g.completed_at.toISOString(),
    }));

    return {
      steamId: player.steam_id,
      personaName: player.persona_name,
      avatarUrl: player.avatar_url,
      ratings,
      overall: overallRating(ratings),
      history,
    };
  });

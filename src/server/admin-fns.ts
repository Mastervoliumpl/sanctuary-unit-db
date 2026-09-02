// Admin: disputes, live games, recent results, and deleting matches that
// shouldn't count. One admin (players.is_admin), server-gated — the page
// only decides what to render, this decides what's allowed.

import { createServerFn } from '@tanstack/react-start';
import { sql } from './db';
import { loadParticipants, toParticipant, toView, type MatchRow } from './match-data';
import { requireAdmin } from './player';
import { isMode, type Mode } from '../lib/ladder-modes';
import type { AdminMatches, DisputeView, LadderMapRow, MatchView } from '../lib/ladder-types';

// ---- map pools -------------------------------------------------------------

export const adminMapPools = createServerFn({ method: 'POST' }).handler(async (): Promise<LadderMapRow[]> => {
  await requireAdmin();
  return sql()<LadderMapRow[]>`select mode, name, size, enabled from ladder_maps order by mode, name`;
});

const mapInput = (data: unknown): { mode: Mode; name: string } => {
  const d = data as { mode?: unknown; name?: unknown } | null;
  if (!isMode(d?.mode)) throw new Error('mode required');
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (name.length < 1 || name.length > 80) throw new Error('name required');
  return { mode: d.mode, name };
};

// Add or update a map in a mode's pool (name is the key, exactly as the
// game's lobby shows it).
export const adminMapSave = createServerFn({ method: 'POST' })
  .validator((data: unknown): LadderMapRow => {
    const { mode, name } = mapInput(data);
    const d = data as { size?: unknown; enabled?: unknown };
    const size = typeof d.size === 'number' && Number.isFinite(d.size) ? Math.round(d.size) : 512;
    return { mode, name, size, enabled: d.enabled !== false };
  })
  .handler(async ({ data }): Promise<void> => {
    await requireAdmin();
    await sql()`
      insert into ladder_maps (mode, name, size, enabled)
      values (${data.mode}, ${data.name}, ${data.size}, ${data.enabled})
      on conflict (mode, name) do update set size = excluded.size, enabled = excluded.enabled`;
  });

export const adminMapDelete = createServerFn({ method: 'POST' })
  .validator(mapInput)
  .handler(async ({ data }): Promise<void> => {
    await requireAdmin();
    await sql()`delete from ladder_maps where mode = ${data.mode} and name = ${data.name}`;
  });

const matchIdInput = (data: unknown): { matchId: string } => {
  const d = data as { matchId?: unknown } | null;
  if (typeof d?.matchId !== 'string' || !/^[0-9a-f-]{36}$/.test(d.matchId)) {
    throw new Error('matchId required');
  }
  return { matchId: d.matchId };
};

async function views(rows: MatchRow[]): Promise<MatchView[]> {
  const participants = await loadParticipants(rows.map((r) => r.id));
  return rows.map((m) =>
    toView(
      m,
      participants.filter((p) => p.match_id === m.id),
    ),
  );
}

export const adminMatches = createServerFn({ method: 'POST' }).handler(async (): Promise<AdminMatches> => {
  await requireAdmin();
  const live = await sql()<MatchRow[]>`
    select * from matches where status in ('in_progress', 'reported', 'disputed')
    order by created_at desc`;
  const recent = await sql()<MatchRow[]>`
    select * from matches where status = 'completed'
    order by completed_at desc limit 25`;
  return { live: await views(live), recent: await views(recent) };
});

// Removes a match outright. Completed ones have their recorded rating
// changes reversed first (see admin_delete_match) — for test games that
// shouldn't have counted.
export const adminDelete = createServerFn({ method: 'POST' })
  .validator(matchIdInput)
  .handler(async ({ data }): Promise<void> => {
    await requireAdmin();
    await sql()`select admin_delete_match(${data.matchId})`;
  });

export const adminDisputes = createServerFn({ method: 'POST' }).handler(async (): Promise<DisputeView[]> => {
  await requireAdmin();
  const rows = await sql()<
    {
      id: string;
      mode: Mode;
      map_name: string;
      created_at: Date;
      reported_winner_team: number | null;
      reported_by: string | null;
      raised_by: string;
      reason: string | null;
    }[]
  >`
      select m.id, m.mode, m.map_name, m.created_at, m.reported_winner_team,
             coalesce(rb.display_name, rb.persona_name) as reported_by,
             coalesce(rp.display_name, rp.persona_name) as raised_by,
             d.reason
      from matches m
      left join players rb on rb.id = m.reported_by
      join lateral (
        select reason, raised_by from disputes where match_id = m.id
        order by created_at desc limit 1
      ) d on true
      join players rp on rp.id = d.raised_by
      where m.status = 'disputed'
      order by m.created_at`;

  const participants = await loadParticipants(rows.map((r) => r.id));
  return rows.map((r) => ({
    matchId: r.id,
    mode: r.mode,
    mapName: r.map_name,
    createdAt: r.created_at.toISOString(),
    reportedBy: r.reported_by,
    reportedWinnerTeam: r.reported_winner_team,
    raisedBy: r.raised_by,
    reason: r.reason ?? '',
    participants: participants.filter((p) => p.match_id === r.id).map(toParticipant),
  }));
});

export const adminResolve = createServerFn({ method: 'POST' })
  .validator((data: unknown): { matchId: string; action: 'team1' | 'team2' | 'void' } => {
    const { matchId } = matchIdInput(data);
    const d = data as { action?: unknown };
    if (d.action !== 'team1' && d.action !== 'team2' && d.action !== 'void') {
      throw new Error('action must be team1, team2 or void');
    }
    return { matchId, action: d.action };
  })
  .handler(async ({ data }): Promise<void> => {
    const me = await requireAdmin();
    if (data.action === 'void') {
      await sql()`
        update matches set status = 'cancelled', cancelled_by = ${me.playerId}
        where id = ${data.matchId} and status = 'disputed'`;
    } else {
      const winnerTeam = data.action === 'team1' ? 1 : 2;
      // Back through the normal path: 'reported' with the ruled winner, then
      // the same apply_match_result every other result goes through.
      const ruled = await sql()`
        update matches set status = 'reported', reported_winner_team = ${winnerTeam}
        where id = ${data.matchId} and status = 'disputed'
        returning id`;
      if (ruled.length > 0) {
        await sql()`select apply_match_result(${data.matchId}, ${winnerTeam})`;
      }
    }
    await sql()`
      update disputes set resolved_at = now(), resolution = ${data.action}
      where match_id = ${data.matchId} and resolved_at is null`;
  });

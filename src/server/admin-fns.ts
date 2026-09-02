// Admin: the disputes queue. One admin (players.is_admin), server-gated —
// the page only decides what to render, this decides what's allowed.

import { createServerFn } from '@tanstack/react-start';
import { sql } from './db';
import { loadParticipants, toParticipant } from './match-data';
import { requireAdmin } from './player';
import type { Mode } from '../lib/ladder-modes';
import type { DisputeView } from '../lib/ladder-types';

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
    const d = data as { matchId?: unknown; action?: unknown } | null;
    if (typeof d?.matchId !== 'string' || !/^[0-9a-f-]{36}$/.test(d.matchId)) {
      throw new Error('matchId required');
    }
    if (d.action !== 'team1' && d.action !== 'team2' && d.action !== 'void') {
      throw new Error('action must be team1, team2 or void');
    }
    return { matchId: d.matchId, action: d.action };
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

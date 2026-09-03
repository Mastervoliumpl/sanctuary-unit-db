// Match rows → DTOs, shared by the match and admin server functions. Server
// only (touches the database); the *-fns modules stay pure RPC surfaces.

import { sql } from './db';
import { teamSize, type Mode } from '../lib/ladder-modes';
import { deriveMmStatus, type Faction, type MmEventType, type MmMode } from '../lib/mm';
import type { MatchParticipant, MatchStatus, MatchView, MmEventView } from '../lib/ladder-types';

export const CANCEL_WINDOW_MINUTES = 5;
export const AUTO_CONFIRM_MINUTES = 15;
export const OPEN_STATES: MatchStatus[] = ['in_progress', 'reported', 'disputed'];

export interface MatchRow {
  id: string;
  mode: Mode;
  status: MatchStatus;
  map_name: string;
  map_path: string | null;
  host_player_id: string;
  reported_by: string | null;
  reported_winner_team: number | null;
  auto_confirm_at: Date | null;
  cancel_requested_by: string | null;
  cancelled_by: string | null;
  created_at: Date;
  completed_at: Date | null;
  mm_mode: MmMode;
  mm_status: 'countdown' | 'launch' | 'cancelled' | 'failed' | null;
  countdown_ends_at: Date | null;
  session_id: string | null;
  mm_reason: string | null;
}

export interface ParticipantRow {
  match_id: string;
  player_id: string;
  team: number;
  rating_before: number;
  rating_after: number | null;
  rating_delta: number | null;
  outcome: 'win' | 'loss' | null;
  faction: Faction | null;
  slot: number | null;
  launchable: boolean;
  steam_id: string;
  persona_name: string;
  avatar_url: string | null;
}

export interface MmEventRow {
  match_id: string;
  player_id: string;
  type: MmEventType;
  detail: string | null;
  persona_name: string;
  created_at: Date;
}

export async function loadMatch(matchId: string): Promise<MatchRow | null> {
  const [match] = await sql()<MatchRow[]>`select * from matches where id = ${matchId}`;
  return match ?? null;
}

export async function loadParticipants(matchIds: string[]): Promise<ParticipantRow[]> {
  if (matchIds.length === 0) return [];
  return sql()<ParticipantRow[]>`
    select mp.match_id, mp.player_id, mp.team, mp.rating_before, mp.rating_after, mp.rating_delta,
           mp.outcome, mp.faction, mp.slot, is_launchable(mp.player_id) as launchable,
           p.steam_id, coalesce(p.display_name, p.persona_name) as persona_name, p.avatar_url
    from match_participants mp join players p on p.id = mp.player_id
    where mp.match_id in ${sql()(matchIds)}
    order by mp.team, p.persona_name`;
}

// What the mods reported, oldest first. Only auto matches have any.
export async function loadMmEvents(matchIds: string[]): Promise<MmEventRow[]> {
  if (matchIds.length === 0) return [];
  return sql()<MmEventRow[]>`
    select e.match_id, e.player_id, e.type, e.detail, e.created_at,
           coalesce(p.display_name, p.persona_name) as persona_name
    from mm_events e join players p on p.id = e.player_id
    where e.match_id in ${sql()(matchIds)}
    order by e.id`;
}

export const toParticipant = (p: ParticipantRow): MatchParticipant => ({
  playerId: p.player_id,
  steamId: p.steam_id,
  personaName: p.persona_name,
  avatarUrl: p.avatar_url,
  team: p.team,
  ratingBefore: p.rating_before,
  ratingAfter: p.rating_after,
  ratingDelta: p.rating_delta,
  outcome: p.outcome,
  faction: p.faction,
  slot: p.slot,
  launchable: p.launchable,
});

const toEvent = (e: MmEventRow): MmEventView => ({
  type: e.type,
  detail: e.detail,
  playerId: e.player_id,
  personaName: e.persona_name,
  at: e.created_at.toISOString(),
});

export const teamOf = (participants: ParticipantRow[], playerId: string | null): number | null =>
  participants.find((p) => p.player_id === playerId)?.team ?? null;

export function toView(m: MatchRow, participants: ParticipantRow[], events: MmEventRow[] = []): MatchView {
  return {
    id: m.id,
    mode: m.mode,
    teamSize: teamSize(m.mode),
    status: m.status,
    mapName: m.map_name,
    mapPath: m.map_path,
    hostPlayerId: m.host_player_id,
    mmMode: m.mm_mode,
    mmStatus: deriveMmStatus({ status: m.status, mmMode: m.mm_mode, mmStatus: m.mm_status }),
    countdownEndsAt: m.countdown_ends_at?.toISOString() ?? null,
    sessionId: m.session_id,
    mmReason: m.mm_reason,
    mmEvents: events.filter((e) => e.match_id === m.id).map(toEvent),
    reportedBy: m.reported_by,
    reportedWinnerTeam: m.reported_winner_team,
    autoConfirmAt: m.auto_confirm_at?.toISOString() ?? null,
    cancelWindowEndsAt: new Date(m.created_at.getTime() + CANCEL_WINDOW_MINUTES * 60_000).toISOString(),
    cancelRequestedByTeam: teamOf(participants, m.cancel_requested_by),
    createdAt: m.created_at.toISOString(),
    completedAt: m.completed_at?.toISOString() ?? null,
    participants: participants.map(toParticipant),
  };
}

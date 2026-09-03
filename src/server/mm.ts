// Server side of the mod-facing matchmaking API (src/routes/api.mm.*):
// bearer sessions minted from Steam tickets, the presence table the
// heartbeat writes, the lazy sweep, and the match object the mod polls for.
// Server only — touches the database and node:crypto.

import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { fetchPersona, verifyWebApiTicket } from './steam';
import {
  deriveMmStatus,
  SESSION_TTL_H,
  TICKET_IDENTITY,
  type Faction,
  type MmMode,
  type MmStatus,
} from '../lib/mm';

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const bad = (status: number, message: string) => json(status, { error: message });

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface ModPlayer {
  playerId: string;
  steamId: string;
  personaName: string;
}

// Verifies the ticket with Steam, makes sure the player exists (a mod user
// may heartbeat before ever signing in on the site) and mints a token.
export async function mintSession(
  ticket: string,
): Promise<{ token: string; player: ModPlayer; expiresAt: Date } | null> {
  const steamId = await verifyWebApiTicket(ticket, TICKET_IDENTITY);
  if (!steamId) return null;

  const persona = await fetchPersona(steamId);
  const [player] = await sql()<{ id: string; persona_name: string; banned_at: Date | null }[]>`
    insert into players (steam_id, persona_name, avatar_url)
    values (${steamId}, ${persona.personaName}, ${persona.avatarUrl})
    on conflict (steam_id) do update set last_seen_at = now()
    returning id, coalesce(display_name, persona_name) as persona_name, banned_at`;
  if (!player || player.banned_at) return null;

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_H * 3_600_000);
  await sql()`delete from mm_sessions where expires_at < now()`;
  await sql()`
    insert into mm_sessions (token_hash, player_id, expires_at)
    values (${hash(token)}, ${player.id}, ${expiresAt})`;
  return { token, player: { playerId: player.id, steamId, personaName: player.persona_name }, expiresAt };
}

// The player behind `Authorization: Bearer <token>`, or null (→ 401, and the
// mod re-mints).
export async function authenticate(request: Request): Promise<ModPlayer | null> {
  const header = request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(header);
  if (!m) return null;
  const [row] = await sql()<{ id: string; steam_id: string; persona_name: string }[]>`
    select p.id, p.steam_id, coalesce(p.display_name, p.persona_name) as persona_name
    from mm_sessions s join players p on p.id = s.player_id
    where s.token_hash = ${hash(m[1])} and s.expires_at > now() and p.banned_at is null`;
  return row ? { playerId: row.id, steamId: row.steam_id, personaName: row.persona_name } : null;
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Everything time-driven, in one call: overdue auto-confirms and the
// auto-launch countdowns/timeouts. Called from every poll-shaped entry point.
export async function sweepAll(): Promise<void> {
  await sql()`select finalize_due_matches()`;
  await sql()`select sweep_mm_matches()`;
}

// ---- the match object the mod sees -----------------------------------------

export interface ModMatch {
  id: string;
  mode: MmMode;
  status: MmStatus;
  host: string;
  joiner: string;
  opponent: { steamId: string; name: string };
  map: string | null; // the game's map path; null on manual matches
  mapName: string;
  factions: Record<string, Faction>;
  slots: Record<string, number>;
  sessionId: string | null;
  countdownEndsAt: string | null;
  cancelledBy: string | null;
  reason: string | null;
}

interface ModMatchRow {
  id: string;
  status: 'in_progress' | 'reported' | 'completed' | 'disputed' | 'cancelled';
  mm_mode: MmMode;
  mm_status: 'countdown' | 'launch' | 'cancelled' | 'failed' | null;
  map_name: string;
  map_path: string | null;
  host_player_id: string;
  session_id: string | null;
  countdown_ends_at: Date | null;
  cancelled_by: string | null;
  mm_reason: string | null;
}

interface ModParticipantRow {
  player_id: string;
  steam_id: string;
  persona_name: string;
  faction: Faction | null;
  slot: number | null;
}

export async function loadModMatch(matchId: string): Promise<ModMatch | null> {
  const [m] = await sql()<ModMatchRow[]>`select * from matches where id = ${matchId}`;
  if (!m) return null;
  return toModMatch(m);
}

// The 1v1 match the mod should be acting on: an open one, or an auto one
// that ended recently (so a cancel or failure reaches a mod mid-launch — an
// open-only lookup would just go quiet on it).
export async function currentModMatch(playerId: string): Promise<ModMatch | null> {
  const [m] = await sql()<ModMatchRow[]>`
    select m.* from matches m
    join match_participants mp on mp.match_id = m.id and mp.player_id = ${playerId}
    where m.mode = '1v1'
      and (m.status in ('in_progress', 'reported', 'disputed')
           or (m.mm_mode = 'auto' and m.created_at > now() - interval '10 minutes'))
    order by (m.status in ('in_progress', 'reported', 'disputed')) desc, m.created_at desc
    limit 1`;
  return m ? toModMatch(m) : null;
}

async function toModMatch(m: ModMatchRow): Promise<ModMatch | null> {
  const players = await sql()<ModParticipantRow[]>`
    select mp.player_id, p.steam_id, coalesce(p.display_name, p.persona_name) as persona_name,
           mp.faction, mp.slot
    from match_participants mp join players p on p.id = mp.player_id
    where mp.match_id = ${m.id}`;
  const host = players.find((p) => p.player_id === m.host_player_id);
  const joiner = players.find((p) => p.player_id !== m.host_player_id);
  if (!host || !joiner || players.length !== 2) return null;

  const factions: Record<string, Faction> = {};
  const slots: Record<string, number> = {};
  for (const p of players) {
    if (p.faction) factions[p.steam_id] = p.faction;
    if (p.slot) slots[p.steam_id] = p.slot;
  }
  const cancelledBy = players.find((p) => p.player_id === m.cancelled_by);

  return {
    id: m.id,
    mode: m.mm_mode,
    status: deriveMmStatus({ status: m.status, mmMode: m.mm_mode, mmStatus: m.mm_status }),
    host: host.steam_id,
    joiner: joiner.steam_id,
    opponent: { steamId: '', name: '' }, // filled per caller below
    map: m.map_path,
    mapName: m.map_name,
    factions,
    slots,
    sessionId: m.session_id,
    countdownEndsAt: m.countdown_ends_at?.toISOString() ?? null,
    cancelledBy: cancelledBy?.steam_id ?? null,
    reason: m.mm_reason,
  };
}

// `opponent` depends on who's asking.
export async function withOpponent(match: ModMatch, mySteamId: string): Promise<ModMatch> {
  const otherSteamId = match.host === mySteamId ? match.joiner : match.host;
  const [row] = await sql()<{ persona_name: string }[]>`
    select coalesce(display_name, persona_name) as persona_name from players where steam_id = ${otherSteamId}`;
  return { ...match, opponent: { steamId: otherSteamId, name: row?.persona_name ?? '' } };
}

export async function isParticipant(matchId: string, playerId: string): Promise<boolean> {
  const rows = await sql()`
    select 1 from match_participants where match_id = ${matchId} and player_id = ${playerId}`;
  return rows.length > 0;
}

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);

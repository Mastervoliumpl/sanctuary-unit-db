// Session → player resolution, shared by the server functions. Kept out of
// the *-fns modules on purpose: those are imported by client code (for the
// RPC stubs), so everything they re-export must be client-safe — this module
// touches the session cookie and the database and must never leave the server.

import { sql } from './db';
import { readSession } from './session';
import type { Me } from '../lib/ladder-types';

interface PlayerRow {
  id: string;
  steam_id: string;
  persona_name: string;
  avatar_url: string | null;
  rating: number;
  games_played: number;
  wins: number;
  losses: number;
  banned_at: Date | null;
}

export const toMe = (p: PlayerRow): Me => ({
  playerId: p.id,
  steamId: p.steam_id,
  personaName: p.persona_name,
  avatarUrl: p.avatar_url,
  rating: p.rating,
  gamesPlayed: p.games_played,
  wins: p.wins,
  losses: p.losses,
});

export async function loadSessionPlayer(): Promise<Me | null> {
  const session = await readSession();
  if (!session) return null;
  const rows = await sql()<PlayerRow[]>`
    select id, steam_id, coalesce(display_name, persona_name) as persona_name,
           avatar_url, rating, games_played, wins, losses, banned_at
    from players where id = ${session.playerId}`;
  const player = rows[0];
  if (!player || player.banned_at) return null;
  return toMe(player);
}

// Inside mutating handlers: resolves the signed-in, unbanned player or throws.
export async function requirePlayer(): Promise<Me> {
  const player = await loadSessionPlayer();
  if (!player) throw new Error('Not signed in');
  return player;
}

// TEMPORARY pre-launch test hook — delete this file (and its button on the
// ladder page) before the ladder goes live. The database gets reset then
// anyway, taking the fake opponent and results with it.

import { createServerFn } from '@tanstack/react-start';
import { sql } from './db';
import { requirePlayer } from './player';
import { LADDER_MAPS_1V1 } from '../lib/ladder-maps';

const DUMMY_STEAM_ID = '76561197960000001';

// Fabricates a completed match where the signed-in player LOSES to a test
// dummy, through the real apply_match_result path — so the leaderboard,
// profile, history and rating graph all light up exactly as a real game
// would.
export const testLoseGame = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ matchId: string }> => {
    const me = await requirePlayer();

    const [dummy] = await sql()<{ id: string }[]>`
      insert into players (steam_id, persona_name)
      values (${DUMMY_STEAM_ID}, 'Practice Dummy')
      on conflict (steam_id) do update set persona_name = excluded.persona_name
      returning id`;

    const map = LADDER_MAPS_1V1[Math.floor(Math.random() * LADDER_MAPS_1V1.length)].name;

    const [match] = await sql()<{ id: string }[]>`
      insert into matches (status, mode, map_name, host_player_id, reported_by,
                           reported_winner_team, auto_confirm_at)
      values ('reported', '1v1', ${map}, ${me.playerId}, ${me.playerId}, 2, now())
      returning id`;

    await sql()`
      insert into match_participants (match_id, player_id, team, rating_before)
      values (${match.id}, ${me.playerId}, 1, ${me.rating}),
             (${match.id}, ${dummy.id}, 2,
              (select rating from players where id = ${dummy.id}))`;

    await sql()`select apply_match_result(${match.id}, 2)`;
    return { matchId: match.id };
  },
);

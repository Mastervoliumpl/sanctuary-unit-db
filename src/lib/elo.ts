// Ladder rating maths. Plain Elo: a dozens-sized player pool can't feed
// Glicko-2's rating periods, and Elo is explainable to players in a sentence.
//
// Results are applied inside the database (supabase/migrations/0003_results.sql
// transcribes these constants) so finalisation is atomic; this module is the
// pinned reference the tests exercise. Change both together.

export const START_RATING = 1000;
export const RATING_FLOOR = 100;
export const PROVISIONAL_GAMES = 10;
export const K_PROVISIONAL = 40;
export const K_STANDARD = 20;

export const kFactor = (gamesPlayed: number): number =>
  gamesPlayed < PROVISIONAL_GAMES ? K_PROVISIONAL : K_STANDARD;

// Probability that `rating` beats `opponent`.
export const expectedScore = (rating: number, opponent: number): number =>
  1 / (1 + 10 ** ((opponent - rating) / 400));

export interface EloPlayer {
  rating: number;
  gamesPlayed: number;
}

export interface EloResult {
  winnerAfter: number;
  loserAfter: number;
  winnerDelta: number;
  loserDelta: number;
}

export interface TeamEloResult {
  winnersAfter: number[]; // same order as the winners passed in
  losersAfter: number[];
}

const average = (team: EloPlayer[]): number => team.reduce((sum, p) => sum + p.rating, 0) / team.length;

// Team games: each player's expected score is against the OPPOSING team's
// average rating, and each moves by their own K (provisional players move
// faster). A 1v1 is the one-player case. The exchange is only zero-sum when
// everyone shares a K — that asymmetry is deliberate: it converges new
// players quickly without letting them farm veterans' points.
export function applyTeamResult(winners: EloPlayer[], losers: EloPlayer[]): TeamEloResult {
  const winnersAverage = average(winners);
  const losersAverage = average(losers);
  return {
    winnersAfter: winners.map((p) =>
      Math.max(
        RATING_FLOOR,
        p.rating + Math.round(kFactor(p.gamesPlayed) * (1 - expectedScore(p.rating, losersAverage))),
      ),
    ),
    losersAfter: losers.map((p) =>
      Math.max(
        RATING_FLOOR,
        p.rating - Math.round(kFactor(p.gamesPlayed) * expectedScore(p.rating, winnersAverage)),
      ),
    ),
  };
}

// The profile's "overall": games-weighted across the modes actually played
// (an untouched 1000 in a mode you've never queued shouldn't drag anything).
// Display only — it drives no matchmaking. Null before any game.
export function overallRating(
  ratings: Partial<Record<string, { rating: number; gamesPlayed: number }>>,
): number | null {
  let weighted = 0;
  let games = 0;
  for (const r of Object.values(ratings)) {
    if (!r || r.gamesPlayed === 0) continue;
    weighted += r.rating * r.gamesPlayed;
    games += r.gamesPlayed;
  }
  return games === 0 ? null : Math.round(weighted / games);
}

export function applyResult(winner: EloPlayer, loser: EloPlayer): EloResult {
  const { winnersAfter, losersAfter } = applyTeamResult([winner], [loser]);
  return {
    winnerAfter: winnersAfter[0],
    loserAfter: losersAfter[0],
    winnerDelta: winnersAfter[0] - winner.rating,
    loserDelta: losersAfter[0] - loser.rating,
  };
}

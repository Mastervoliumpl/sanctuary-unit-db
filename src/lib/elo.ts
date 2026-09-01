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

// Each player moves by their own K (provisional players move faster), so the
// exchange is only zero-sum when both are on the same K — that asymmetry is
// deliberate, it converges new players quickly without letting them farm
// veterans' points.
export function applyResult(winner: EloPlayer, loser: EloPlayer): EloResult {
  const expected = expectedScore(winner.rating, loser.rating);
  const winnerAfter = Math.max(
    RATING_FLOOR,
    winner.rating + Math.round(kFactor(winner.gamesPlayed) * (1 - expected)),
  );
  const loserAfter = Math.max(
    RATING_FLOOR,
    loser.rating - Math.round(kFactor(loser.gamesPlayed) * (1 - expected)),
  );
  return {
    winnerAfter,
    loserAfter,
    winnerDelta: winnerAfter - winner.rating,
    loserDelta: loserAfter - loser.rating,
  };
}

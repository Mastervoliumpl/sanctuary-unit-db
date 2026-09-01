// Matchmaking rules, mirrored from the database where they actually run
// (supabase/migrations/0002_ladder.sql: queue_radius() and pair_queue()).
// The SQL is the live copy; this module pins the same behaviour under vitest.
// Change both together.

export const RADIUS_BASE = 100;
export const RADIUS_PER_MINUTE = 100;

// How far from your own rating the matchmaker will look, widening the longer
// you wait: ±100 at join, +100 per full minute in queue. With a small player
// pool everyone becomes matchable within a few minutes.
export const searchRadius = (secondsInQueue: number): number =>
  RADIUS_BASE + RADIUS_PER_MINUTE * Math.floor(secondsInQueue / 60);

export interface QueueCandidate {
  playerId: string;
  rating: number;
  joinedAtMs: number;
}

// A pair forms only when each is inside the OTHER's radius too — otherwise a
// long-waiting player would drag fresh joiners far outside their own band.
export function canPair(a: QueueCandidate, b: QueueCandidate, nowMs: number): boolean {
  const radiusA = searchRadius((nowMs - a.joinedAtMs) / 1000);
  const radiusB = searchRadius((nowMs - b.joinedAtMs) / 1000);
  return Math.abs(a.rating - b.rating) <= Math.min(radiusA, radiusB);
}

// One pairing pass: oldest entry first, matched to the oldest mutual
// candidate. Same traversal order as pair_queue().
export function pairQueue(entries: QueueCandidate[], nowMs: number): Array<[string, string]> {
  const waiting = [...entries].sort((a, b) => a.joinedAtMs - b.joinedAtMs);
  const paired = new Set<string>();
  const pairs: Array<[string, string]> = [];

  for (const a of waiting) {
    if (paired.has(a.playerId)) continue;
    const b = waiting.find((e) => e !== a && !paired.has(e.playerId) && canPair(a, e, nowMs));
    if (!b) continue;
    paired.add(a.playerId);
    paired.add(b.playerId);
    pairs.push([a.playerId, b.playerId]);
  }

  return pairs;
}

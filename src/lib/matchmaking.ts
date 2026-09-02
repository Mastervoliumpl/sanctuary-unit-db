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

// One matchmaking pass for a mode needing `needed` players: each waiter in
// turn (oldest first) anchors a group of the oldest candidates inside its
// mutual radius; the first anchor that gathers enough forms a game. Same
// traversal order as pair_queue(). Candidates are checked against the
// anchor, not each other — with a small pool that's the pragmatic bound.
export function formGroups(entries: QueueCandidate[], needed: number, nowMs: number): QueueCandidate[][] {
  const waiting = [...entries].sort((a, b) => a.joinedAtMs - b.joinedAtMs);
  const used = new Set<string>();
  const groups: QueueCandidate[][] = [];

  for (const anchor of waiting) {
    if (used.has(anchor.playerId)) continue;
    const group = [anchor];
    for (const e of waiting) {
      if (group.length === needed) break;
      if (e === anchor || used.has(e.playerId)) continue;
      if (canPair(anchor, e, nowMs)) group.push(e);
    }
    if (group.length < needed) continue;
    for (const g of group) used.add(g.playerId);
    groups.push(group);
  }

  return groups;
}

// The 1v1 pass, as pairs.
export function pairQueue(entries: QueueCandidate[], nowMs: number): Array<[string, string]> {
  return formGroups(entries, 2, nowMs).map((g) => [g[0].playerId, g[1].playerId]);
}

export interface SplitCandidate {
  playerId: string;
  rating: number;
}

export interface Split {
  team1: string[];
  team2: string[];
  gap: number; // difference between team rating averages
}

// Balances a formed group into two teams: every partition with player 0
// pinned to team 1 (so mirrors aren't counted twice — 3 splits for 2v2, 10
// for 3v3), lowest gap between team averages wins, first found on ties.
// Mirrored in pair_queue() as a bitmask loop with the same iteration order.
export function bestSplit(players: SplitCandidate[], teamSize: number): Split {
  const n = players.length;
  let best: Split | null = null;

  for (let mask = 1; mask < 1 << n; mask += 2) {
    let bits = 0;
    let sum1 = 0;
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      if ((mask >> i) & 1) {
        bits++;
        sum1 += players[i].rating;
      } else {
        sum2 += players[i].rating;
      }
    }
    if (bits !== teamSize) continue;
    const gap = Math.abs(sum1 - sum2) / teamSize;
    if (best === null || gap < best.gap) {
      best = {
        team1: players.filter((_, i) => (mask >> i) & 1).map((p) => p.playerId),
        team2: players.filter((_, i) => !((mask >> i) & 1)).map((p) => p.playerId),
        gap,
      };
    }
  }

  return best!;
}

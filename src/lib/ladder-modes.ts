// The ladder's game modes. Everything mode-shaped (queues, ratings, pools,
// leaderboards) keys off these three strings; the SQL side carries the same
// list as check constraints.

export type Mode = '1v1' | '2v2' | '3v3';

export const MODES: Mode[] = ['1v1', '2v2', '3v3'];

const TEAM_SIZE: Record<Mode, number> = { '1v1': 1, '2v2': 2, '3v3': 3 };

export const teamSize = (mode: Mode): number => TEAM_SIZE[mode];

// Players a match needs before it can form.
export const playersNeeded = (mode: Mode): number => TEAM_SIZE[mode] * 2;

export const isMode = (value: unknown): value is Mode =>
  typeof value === 'string' && (MODES as string[]).includes(value);

// Leaderboard tabs: the three modes plus the games-weighted overall view.
export type LeaderboardMode = Mode | 'overall';

export const isLeaderboardMode = (value: unknown): value is LeaderboardMode =>
  value === 'overall' || isMode(value);

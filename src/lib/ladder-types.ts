// DTOs shared between the ladder server functions (src/server/*-fns.ts) and
// the ladder UI. Plain JSON shapes — dates travel as ISO strings.

import type { Mode } from './ladder-modes';

export interface Me {
  playerId: string;
  steamId: string;
  personaName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  openMatchId: string | null; // a match in progress/reported/disputed — the header links to it
}

export interface QueueModeStatus {
  inQueue: boolean;
  queuedSeconds: number | null;
  searchRadius: number | null;
  waiting: number; // everyone in this mode's queue, including you
  needed: number;
}

// One poll answers for every queue at once.
export interface PlayStatus {
  matchId: string | null; // an open match to go to instead of queueing
  queues: Record<Mode, QueueModeStatus>;
  liveGames: number; // matches in progress right now, all modes
}

export interface QueueCounts {
  waiting: Record<Mode, number>;
  liveGames: number;
}

export type MatchStatus = 'in_progress' | 'reported' | 'completed' | 'disputed' | 'cancelled';

export interface MatchParticipant {
  playerId: string;
  steamId: string;
  personaName: string;
  avatarUrl: string | null;
  team: number;
  ratingBefore: number;
  ratingAfter: number | null;
  ratingDelta: number | null;
  outcome: 'win' | 'loss' | null;
}

export interface MatchView {
  id: string;
  mode: Mode;
  teamSize: number;
  status: MatchStatus;
  mapName: string;
  hostPlayerId: string;
  participants: MatchParticipant[];
  reportedBy: string | null;
  reportedWinnerTeam: number | null;
  autoConfirmAt: string | null;
  cancelWindowEndsAt: string; // free cancel until then; after, both sides must ask
  cancelRequestedByTeam: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface LeaderboardRow {
  rank: number;
  steamId: string;
  personaName: string;
  avatarUrl: string | null;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

export interface RatingSummary {
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

export interface ProfileOpponent {
  steamId: string;
  personaName: string;
}

export interface ProfileMatch {
  matchId: string;
  mode: Mode;
  mapName: string;
  opponents: ProfileOpponent[];
  outcome: 'win' | 'loss';
  ratingAfter: number;
  ratingDelta: number;
  completedAt: string;
}

export interface Profile {
  steamId: string;
  personaName: string;
  avatarUrl: string | null;
  ratings: Partial<Record<Mode, RatingSummary>>; // only modes with a row
  overall: number | null; // games-weighted across played modes; null before any game
  history: ProfileMatch[]; // oldest first, all modes
}

export interface AdminMatches {
  live: MatchView[]; // in progress, reported or disputed
  recent: MatchView[]; // latest completed
}

export interface DisputeView {
  matchId: string;
  mode: Mode;
  mapName: string;
  createdAt: string;
  reportedBy: string | null; // persona name
  reportedWinnerTeam: number | null;
  raisedBy: string; // persona name
  reason: string;
  participants: MatchParticipant[];
}

// DTOs shared between the ladder server functions (src/server/*-fns.ts) and
// the ladder UI. Plain JSON shapes — dates travel as ISO strings.

export interface Me {
  playerId: string;
  steamId: string;
  personaName: string;
  avatarUrl: string | null;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

export type QueueStatus =
  | { state: 'idle' }
  | { state: 'queued'; queuedSeconds: number; searchRadius: number }
  | { state: 'matched'; matchId: string };

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
  status: MatchStatus;
  mapName: string;
  hostPlayerId: string;
  participants: MatchParticipant[];
  reportedBy: string | null;
  reportedWinnerTeam: number | null;
  autoConfirmAt: string | null;
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

export interface ProfileMatch {
  matchId: string;
  mapName: string;
  opponentName: string;
  opponentSteamId: string;
  outcome: 'win' | 'loss';
  ratingAfter: number;
  ratingDelta: number;
  completedAt: string;
}

export interface Profile {
  steamId: string;
  personaName: string;
  avatarUrl: string | null;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  history: ProfileMatch[]; // oldest first
}

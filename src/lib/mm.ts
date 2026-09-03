// Auto-launch matchmaking: the shapes and constants shared by the mod-facing
// API (src/routes/api.mm.*), the ladder server functions and the UI. The
// timings are mirrored in supabase/migrations/0009_matchmaking.sql, where
// the sweep actually enforces them — change both together.

export const FACTIONS = ['EDA', 'Chosen', 'Guard'] as const;
export type Faction = (typeof FACTIONS)[number];

export const isFaction = (v: unknown): v is Faction =>
  typeof v === 'string' && (FACTIONS as readonly string[]).includes(v);

// What the mod says the game is doing. Only `menu` can be launched into a match.
export const MOD_STATES = ['menu', 'lobby', 'loading', 'ingame'] as const;
export type ModState = (typeof MOD_STATES)[number];

export const isModState = (v: unknown): v is ModState =>
  typeof v === 'string' && (MOD_STATES as readonly string[]).includes(v);

export const MM_EVENT_TYPES = ['lobby_created', 'joined', 'ready', 'started', 'failed', 'left'] as const;
export type MmEventType = (typeof MM_EVENT_TYPES)[number];

export const isMmEventType = (v: unknown): v is MmEventType =>
  typeof v === 'string' && (MM_EVENT_TYPES as readonly string[]).includes(v);

export type MmMode = 'auto' | 'manual';

// The lifecycle the mod sees. `manual` is this site's addition to the plan:
// an open match the mod must not launch (it just reports the result).
export type MmStatus = 'countdown' | 'launch' | 'cancelled' | 'failed' | 'done' | 'manual';

// The identity string the mod mints its Steam tickets with (LadderReporter's
// TicketIdentity); the session endpoint accepts exactly this.
export const TICKET_IDENTITY = 'sanctuarydb-ladder';

export const LAUNCHABLE_WINDOW_S = 15; // a heartbeat older than this means the game is gone
export const COUNTDOWN_S = 10;
export const SESSION_TTL_H = 6;
export const TIMEOUT_SESSION_S = 20; // host must post the lobby's session id
export const TIMEOUT_JOIN_S = 30; // joiner must report `joined` after the session id
export const TIMEOUT_START_S = 60; // both must report `started` after launch

// A player is launchable while their last heartbeat is fresh and says `menu`.
export function isLaunchable(seenAtMs: number | null, state: ModState | null, nowMs: number): boolean {
  if (seenAtMs === null || state !== 'menu') return false;
  return nowMs - seenAtMs < LAUNCHABLE_WINDOW_S * 1000;
}

export interface MmStatusSource {
  status: 'in_progress' | 'reported' | 'completed' | 'disputed' | 'cancelled';
  mmMode: MmMode;
  mmStatus: 'countdown' | 'launch' | 'cancelled' | 'failed' | null;
}

// The database only records the auto lifecycle (countdown → launch, and the
// two ways it ends early); everything else follows from the ladder status.
export function deriveMmStatus(m: MmStatusSource): MmStatus {
  if (m.status === 'completed') return 'done';
  if (m.status === 'cancelled') return m.mmStatus === 'failed' ? 'failed' : 'cancelled';
  if (m.mmMode === 'manual') return 'manual';
  if (m.mmStatus === 'countdown' || m.mmStatus === 'launch') return m.mmStatus;
  return 'manual';
}

// The events, in order, tell the match page how far the launch has got.
export function launchProgress(
  events: { type: MmEventType; playerId: string }[],
  hostId: string,
  joinerId: string,
): { lobbyCreated: boolean; joined: boolean; started: boolean } {
  const has = (type: MmEventType, playerId: string) =>
    events.some((e) => e.type === type && e.playerId === playerId);
  return {
    lobbyCreated: has('lobby_created', hostId),
    joined: has('joined', joinerId),
    started: has('started', hostId) && has('started', joinerId),
  };
}

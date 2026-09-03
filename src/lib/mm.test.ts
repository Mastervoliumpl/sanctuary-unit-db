import { describe, expect, it } from 'vitest';
import { COUNTDOWN_S, LAUNCHABLE_WINDOW_S, deriveMmStatus, isLaunchable, launchProgress } from './mm';

describe('isLaunchable', () => {
  const now = 1_000_000;
  it('needs a fresh heartbeat in the menu', () => {
    expect(isLaunchable(now - 5_000, 'menu', now)).toBe(true);
    expect(isLaunchable(now - (LAUNCHABLE_WINDOW_S * 1000 - 1), 'menu', now)).toBe(true);
  });
  it('is false once the heartbeat goes stale', () => {
    expect(isLaunchable(now - LAUNCHABLE_WINDOW_S * 1000, 'menu', now)).toBe(false);
    expect(isLaunchable(null, 'menu', now)).toBe(false);
  });
  it('is false anywhere but the menu', () => {
    expect(isLaunchable(now, 'lobby', now)).toBe(false);
    expect(isLaunchable(now, 'loading', now)).toBe(false);
    expect(isLaunchable(now, 'ingame', now)).toBe(false);
    expect(isLaunchable(now, null, now)).toBe(false);
  });
});

describe('deriveMmStatus', () => {
  it('follows the ladder status once a match is settled', () => {
    expect(deriveMmStatus({ status: 'completed', mmMode: 'auto', mmStatus: 'launch' })).toBe('done');
    expect(deriveMmStatus({ status: 'completed', mmMode: 'manual', mmStatus: null })).toBe('done');
    expect(deriveMmStatus({ status: 'cancelled', mmMode: 'auto', mmStatus: 'cancelled' })).toBe('cancelled');
    expect(deriveMmStatus({ status: 'cancelled', mmMode: 'auto', mmStatus: 'countdown' })).toBe('cancelled');
    expect(deriveMmStatus({ status: 'cancelled', mmMode: 'manual', mmStatus: null })).toBe('cancelled');
  });
  it('keeps a failure distinct from a cancel', () => {
    expect(deriveMmStatus({ status: 'cancelled', mmMode: 'auto', mmStatus: 'failed' })).toBe('failed');
  });
  it('reports the auto lifecycle while open', () => {
    expect(deriveMmStatus({ status: 'in_progress', mmMode: 'auto', mmStatus: 'countdown' })).toBe(
      'countdown',
    );
    expect(deriveMmStatus({ status: 'in_progress', mmMode: 'auto', mmStatus: 'launch' })).toBe('launch');
    expect(deriveMmStatus({ status: 'reported', mmMode: 'auto', mmStatus: 'launch' })).toBe('launch');
  });
  it('is manual for every open manual match, including a fallen-back one', () => {
    expect(deriveMmStatus({ status: 'in_progress', mmMode: 'manual', mmStatus: null })).toBe('manual');
    expect(deriveMmStatus({ status: 'reported', mmMode: 'manual', mmStatus: null })).toBe('manual');
  });
});

describe('launchProgress', () => {
  const host = 'h';
  const joiner = 'j';
  it('starts with nothing', () => {
    expect(launchProgress([], host, joiner)).toEqual({ lobbyCreated: false, joined: false, started: false });
  });
  it('only counts each event from the right side', () => {
    expect(launchProgress([{ type: 'lobby_created', playerId: joiner }], host, joiner).lobbyCreated).toBe(
      false,
    );
    expect(launchProgress([{ type: 'joined', playerId: host }], host, joiner).joined).toBe(false);
    expect(launchProgress([{ type: 'lobby_created', playerId: host }], host, joiner).lobbyCreated).toBe(true);
    expect(launchProgress([{ type: 'joined', playerId: joiner }], host, joiner).joined).toBe(true);
  });
  it('needs both starts', () => {
    expect(launchProgress([{ type: 'started', playerId: host }], host, joiner).started).toBe(false);
    expect(
      launchProgress(
        [
          { type: 'started', playerId: host },
          { type: 'started', playerId: joiner },
        ],
        host,
        joiner,
      ).started,
    ).toBe(true);
  });
});

// Pinned so a change here is a deliberate one made together with the SQL.
it('pins the timings mirrored in 0009_matchmaking.sql', () => {
  expect(COUNTDOWN_S).toBe(10);
  expect(LAUNCHABLE_WINDOW_S).toBe(15);
});

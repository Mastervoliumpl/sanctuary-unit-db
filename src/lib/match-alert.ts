// The "match found" alert: a repeating ding, a flashing tab title and (opt
// in) a native browser notification, running until the player acknowledges
// it on the match page. Module-level so it survives the navigation from
// /play to the match room. Settings persist per browser in localStorage.
//
// The ding is synthesised with the Web Audio API — no audio file to ship —
// and needs an AudioContext created inside a user gesture (browser autoplay
// rules), which is why primeAudio() runs on the "Find match" click.

import { useSyncExternalStore } from 'react';

export interface AlertSettings {
  sound: boolean;
  volume: number; // 0..1
  native: boolean; // browser notifications
}

const SETTINGS_KEY = 'sdb.matchAlert';
const DEFAULTS: AlertSettings = { sound: true, volume: 0.6, native: false };
const FLASH_TITLE = '🔔 Match found!';
const DING_EVERY_MS = 2500;

export function loadSettings(): AlertSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AlertSettings>;
    return {
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULTS.sound,
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULTS.volume,
      native: typeof parsed.native === 'boolean' ? parsed.native : DEFAULTS.native,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: AlertSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or blocked storage — the session still works, just unsaved.
  }
}

// ---- audio -----------------------------------------------------------------

let audio: AudioContext | null = null;

// Call from a click handler: creates (or resumes) the context while the
// browser considers us gestured, so later dings are allowed to play.
export function primeAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

// Two quick rising tones — "ding ding".
function ding(volume: number): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const at = ctx.currentTime;
    for (const [offset, freq] of [
      [0, 880],
      [0.18, 1174.66],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, at + offset);
      gain.gain.linearRampToValueAtTime(volume, at + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at + offset);
      osc.stop(at + offset + 0.4);
    }
  } catch {
    // No audio available; the title flash and notification still fire.
  }
}

export function previewDing(): void {
  primeAudio();
  ding(loadSettings().volume);
}

// ---- notifications ---------------------------------------------------------

export const nativeSupported = (): boolean => typeof Notification !== 'undefined';

// Asks for permission (must run from a click). Resolves to whether we may
// notify.
export async function enableNative(): Promise<boolean> {
  if (!nativeSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

function notify(): void {
  if (!nativeSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('Match found!', {
      body: 'Your ranked game is ready — open SanctuaryDB to see the map and your opponents.',
      tag: 'sdb-match-found',
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some browsers throw for the constructor on mobile; nothing to do.
  }
}

// ---- the alert itself ------------------------------------------------------

let activeMatchId: string | null = null;
let dingTimer: ReturnType<typeof setInterval> | null = null;
let titleTimer: ReturnType<typeof setInterval> | null = null;
let savedTitle = '';
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function startTitleFlash(): void {
  let on = false;
  titleTimer = setInterval(() => {
    on = !on;
    if (on) {
      // Routes update the title on navigation; remember whatever the real
      // one currently is so the flash always alternates with the right text.
      if (document.title !== FLASH_TITLE) savedTitle = document.title;
      document.title = FLASH_TITLE;
    } else {
      document.title = savedTitle;
    }
  }, 1000);
}

export function startMatchAlert(matchId: string): void {
  if (activeMatchId === matchId) return;
  stopMatchAlert();
  activeMatchId = matchId;
  const settings = loadSettings();

  if (settings.sound) {
    ding(settings.volume);
    dingTimer = setInterval(() => ding(settings.volume), DING_EVERY_MS);
  }
  startTitleFlash();
  if (settings.native) notify();
  emit();
}

export function stopMatchAlert(): void {
  if (dingTimer) clearInterval(dingTimer);
  if (titleTimer) clearInterval(titleTimer);
  dingTimer = null;
  titleTimer = null;
  if (typeof document !== 'undefined' && document.title === FLASH_TITLE) document.title = savedTitle;
  if (activeMatchId !== null) {
    activeMatchId = null;
    emit();
  }
}

// The match id the alert is currently sounding for, or null.
export function useMatchAlert(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => activeMatchId,
    () => null,
  );
}

// The "when a match is found" preferences on the Play page: sound on/off
// and volume, and the opt-in browser notification. Saved per browser.

import { useState } from 'react';
import {
  enableNative,
  loadSettings,
  nativeSupported,
  previewDing,
  saveSettings,
  type AlertSettings as Settings,
} from '../lib/match-alert';

export function AlertSettings() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [nativeNote, setNativeNote] = useState<string | null>(null);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  return (
    <div className="queue-widget alert-settings">
      <h2>When a match is found</h2>
      <p className="dim">It keeps dinging and flashing the tab until you press OK on the match page.</p>
      <label className="alert-row">
        <input
          type="checkbox"
          checked={settings.sound}
          onChange={(e) => update({ sound: e.target.checked })}
        />
        Play a sound
      </label>
      <label className="alert-row alert-volume">
        <span className="dim">Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.volume}
          disabled={!settings.sound}
          onChange={(e) => update({ volume: Number(e.target.value) })}
        />
        <button type="button" className="linkish" disabled={!settings.sound} onClick={previewDing}>
          Preview
        </button>
      </label>
      {nativeSupported() && (
        <label className="alert-row">
          <input
            type="checkbox"
            checked={settings.native}
            onChange={async (e) => {
              if (!e.target.checked) {
                update({ native: false });
                setNativeNote(null);
                return;
              }
              const ok = await enableNative();
              update({ native: ok });
              setNativeNote(
                ok
                  ? null
                  : 'Your browser blocked notifications for this site — allow them in its site settings.',
              );
            }}
          />
          Browser notification
        </label>
      )}
      {nativeNote && <p className="queue-error">{nativeNote}</p>}
    </div>
  );
}

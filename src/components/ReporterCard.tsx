// The auto-reporter download card on the ladder page: what the mod does, one
// zip, and the install steps — same collapsed-details pattern as the maps
// page's install help. The zip is a GitHub release asset, like the maps.

import { useState } from 'react';
import { copyText } from '../lib/clipboard';

export const REPORTER_VERSION = '0.1.0';
const DOWNLOAD_URL = `https://github.com/Remmyboy/sanctuary-unit-db/releases/download/ladder-reporter-${REPORTER_VERSION}/LadderReporter-${REPORTER_VERSION}.zip`;

// Where the game reads mods from. The install root moves with the branch and
// the Steam library, so this is the common default rather than a promise.
const ENGINE_PATH =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Sanctuary Shattered Sun Playtest\\engine';

export function ReporterCard() {
  const [copied, setCopied] = useState(false);

  return (
    <div className="queue-widget reporter-card">
      <h2>Auto-reporting</h2>
      <p className="dim">
        Install the reporter mod once and your results log themselves — no clicking win/loss after a game. It
        speaks with your game's own Steam session, so there's nothing to set up or sign in to.
      </p>
      <a className="dl-btn" href={DOWNLOAD_URL}>
        Download reporter · v{REPORTER_VERSION}
      </a>
      <details className="install">
        <summary>How to install it</summary>
        <ol>
          <li>
            Extract the zip into your Sanctuary <code>engine</code> folder, so <code>winhttp.dll</code> sits
            next to <code>Sanctuary.exe</code>.
          </li>
          <li>Launch the game. Done — play ranked and results just appear here.</li>
        </ol>
        <div className="install-path">
          <code>{ENGINE_PATH}</code>
          <button
            type="button"
            className="linkish"
            onClick={async () => {
              if (await copyText(ENGINE_PATH)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <p className="hint">
          Already running BepInEx mods? Just drop <code>BepInEx\plugins\LadderReporter.dll</code> from the zip
          into your existing <code>BepInEx\plugins</code>. The mod only reports Steam lobby 1v1s that match an
          open ladder game — skirmish, LAN, observing and casual games are ignored, and either player having
          it installed is enough.
        </p>
      </details>
    </div>
  );
}

// The mod download card on the Play page: what the LadderReporter does, the
// three ways to get it, and the install steps — same collapsed-details
// pattern as the maps page's install help. The zips are release assets on
// the open-source sanctuary-mods repo, so bumping a version here is the
// whole deploy.

import { useState } from 'react';
import { copyText } from '../lib/clipboard';

export const MODS_REPO = 'https://github.com/Remmyboy/sanctuary-mods';
export const MOD_MANAGER_VERSION = '0.2.0';
export const REPORTER_VERSION = '0.2.3';

const release = (tag: string, file: string) => `${MODS_REPO}/releases/download/${tag}/${file}`;

export const DOWNLOADS = {
  modManager: release(`ModManager-${MOD_MANAGER_VERSION}`, `ModManager-${MOD_MANAGER_VERSION}.zip`),
  reporterForModManager: release(
    `LadderReporter-${REPORTER_VERSION}`,
    `LadderReporter-${REPORTER_VERSION}-ModManager.zip`,
  ),
  reporterStandalone: release(
    `LadderReporter-${REPORTER_VERSION}`,
    `LadderReporter-${REPORTER_VERSION}-Standalone.zip`,
  ),
};

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
        Install the LadderReporter mod to automatically start your game when you match an opponent, and to log
        the result when you finish — automatically.
      </p>

      <ul className="mod-downloads">
        <li>
          <div>
            <strong>Mod Manager</strong>
            <p className="dim">
              Everything you need to start modding Sanctuary: a Mods page in the main menu, and it loads any
              mod in the <code>SanctuaryMods</code> folder.
            </p>
          </div>
          <a className="dl-btn" href={DOWNLOADS.modManager}>
            Download · v{MOD_MANAGER_VERSION}
          </a>
        </li>
        <li>
          <div>
            <strong>LadderReporter</strong> <span className="dim">for the Mod Manager</span>
            <p className="dim">
              Just the mod: auto-launches the game when you're matched and reports the result. Needs the Mod
              Manager.
            </p>
          </div>
          <a className="dl-btn" href={DOWNLOADS.reporterForModManager}>
            Download · v{REPORTER_VERSION}
          </a>
        </li>
        <li>
          <div>
            <strong>LadderReporter</strong> <span className="dim">standalone</span>
            <p className="dim">The same mod with everything it needs to run, without the Mod Manager.</p>
          </div>
          <a className="dl-btn" href={DOWNLOADS.reporterStandalone}>
            Download · v{REPORTER_VERSION}
          </a>
        </li>
      </ul>

      <details className="install">
        <summary>How to install it</summary>
        <ol>
          <li>
            Extract the zip into your Sanctuary <code>engine</code> folder, so <code>winhttp.dll</code> sits
            next to <code>Sanctuary.exe</code>.
          </li>
          <li>Launch the game and play ranked — matches start themselves and results appear here.</li>
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
          The mod only reports Steam lobby 1v1s that match an open ladder game — skirmish, LAN, observing and
          casual games are ignored. Source and release notes:{' '}
          <a href={MODS_REPO} target="_blank" rel="noreferrer">
            sanctuary-mods on GitHub
          </a>
          .
        </p>
      </details>
    </div>
  );
}

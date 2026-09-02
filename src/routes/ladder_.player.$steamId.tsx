// A player's public ladder profile: every mode's rating, the overall, match
// history across modes and a rating graph per mode. Public — completed
// matches are the ladder's record. On your own profile you can set a custom
// display name (empty = your Steam name).

import { useEffect, useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { RatingGraph } from '../components/RatingGraph';
import { loadMe } from '../lib/auth';
import { MODES, isMode, type Mode } from '../lib/ladder-modes';
import { setDisplayName } from '../server/auth-fns';
import { profileGet } from '../server/match-fns';
import type { Me, Profile } from '../lib/ladder-types';

interface ProfileSearch {
  mode?: string;
}

const str = (v: unknown): string | undefined => {
  const s = v == null ? '' : String(v);
  return s ? s : undefined;
};

export const Route = createFileRoute('/ladder_/player/$steamId')({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): ProfileSearch => ({ mode: str(raw.mode) }),
  head: () => ({ meta: [{ title: 'Player — SanctuaryDB' }] }),
  loader: ({ params }): Promise<Profile | null> =>
    profileGet({ data: { steamId: params.steamId } }).catch(() => null),
  component: PlayerPage,
});

function NameEditor({ current }: { current: string }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button type="button" className="linkish" onClick={() => setEditing(true)}>
        Change name
      </button>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setDisplayName({ data: { name } });
      // Name shows in the header, leaderboard and this page — a reload is the
      // honest way to refresh all of them at once.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through — try again.');
      setBusy(false);
    }
  };

  return (
    <form
      className="name-edit"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        value={name}
        maxLength={24}
        autoFocus
        placeholder="Display name"
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="btn primary" disabled={busy}>
        Save
      </button>
      <button type="button" className="linkish" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </button>
      <p className="hint">
        2–24 characters: letters, numbers, spaces, . _ - . Leave empty to use your Steam name.
      </p>
      {error && <p className="queue-error">{error}</p>}
    </form>
  );
}

function PlayerPage() {
  const profile = Route.useLoaderData();
  const search = Route.useSearch();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;
    loadMe().then((m) => alive && setMe(m));
    return () => {
      alive = false;
    };
  }, []);

  if (!profile) {
    return (
      <main className="profile">
        <p className="empty">
          No ladder profile here. <Link to="/ladder">Back to the ladder</Link>
        </p>
      </main>
    );
  }

  // The graph follows ?mode=, falling back to the first mode with games.
  const playedModes = MODES.filter((m) => (profile.ratings[m]?.gamesPlayed ?? 0) > 0);
  const graphMode: Mode | null =
    isMode(search.mode) && playedModes.includes(search.mode) ? search.mode : (playedModes[0] ?? null);
  const series = graphMode
    ? profile.history.filter((h) => h.mode === graphMode).map((h) => h.ratingAfter)
    : [];

  return (
    <main className="profile">
      <Link to="/ladder" className="linkish back">
        ← Ladder
      </Link>

      <header className="profile-head">
        {profile.avatarUrl && <img src={profile.avatarUrl} alt="" width={56} height={56} />}
        <div>
          <h1>{profile.personaName}</h1>
          {me?.steamId === profile.steamId && <NameEditor current={profile.personaName} />}
        </div>
      </header>

      <div className="rating-chips">
        {MODES.map((m) => {
          const r = profile.ratings[m];
          return (
            <div className="rating-chip" key={m}>
              <div className="rk">{m}</div>
              {r && r.gamesPlayed > 0 ? (
                <>
                  <div className="lb-rating">{r.rating}</div>
                  <div className="dim">
                    {r.wins}W {r.losses}L
                  </div>
                </>
              ) : (
                <div className="dim">unrated</div>
              )}
            </div>
          );
        })}
        <div className="rating-chip overall">
          <div className="rk">Overall</div>
          {profile.overall !== null ? (
            <div className="lb-rating">{profile.overall}</div>
          ) : (
            <div className="dim">unrated</div>
          )}
        </div>
      </div>

      {graphMode && (
        <>
          {playedModes.length > 1 && (
            <nav className="mode-tabs">
              {playedModes.map((m) => (
                <Link
                  key={m}
                  to="/ladder/player/$steamId"
                  params={{ steamId: profile.steamId }}
                  search={{ mode: m }}
                  className="mode-tab"
                  data-active={m === graphMode || undefined}
                >
                  {m}
                </Link>
              ))}
            </nav>
          )}
          <RatingGraph ratings={series} />
        </>
      )}

      {profile.history.length === 0 ? (
        <p className="empty">No ranked games yet.</p>
      ) : (
        <table className="lb-table history">
          <thead>
            <tr>
              <th>Result</th>
              <th>Mode</th>
              <th>Opponents</th>
              <th>Map</th>
              <th>Rating</th>
              <th>Played</th>
            </tr>
          </thead>
          <tbody>
            {[...profile.history].reverse().map((h) => (
              <tr key={h.matchId}>
                <td>
                  <span className={`outcome ${h.outcome}`}>{h.outcome}</span>
                </td>
                <td className="dim">{h.mode}</td>
                <td>
                  {h.opponents.map((o, i) => (
                    <span key={o.steamId}>
                      {i > 0 && ', '}
                      <Link to="/ladder/player/$steamId" params={{ steamId: o.steamId }}>
                        {o.personaName}
                      </Link>
                    </span>
                  ))}
                </td>
                <td>{h.mapName}</td>
                <td>
                  {h.ratingAfter}{' '}
                  <span className={h.ratingDelta >= 0 ? 'delta-up' : 'delta-down'}>
                    {h.ratingDelta >= 0 ? '+' : ''}
                    {h.ratingDelta}
                  </span>
                </td>
                <td className="dim">{new Date(h.completedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

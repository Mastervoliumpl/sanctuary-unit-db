// The header's account corner: Steam sign-in when signed out, avatar + name
// (linking to your ladder profile) when signed in.
//
// Renders nothing until mounted: the header is part of the prerendered shell,
// and an /api/auth/steam anchor in static HTML would send the build's link
// crawler into the auth flow.

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { loadMe } from '../lib/auth';
import type { Me } from '../lib/ladder-types';

async function signOut() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Cookie clearing failed (offline?) — the reload will show the truth.
  }
  window.location.href = '/';
}

export function AuthChip() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    loadMe().then((m) => alive && setMe(m));
    return () => {
      alive = false;
    };
  }, []);

  if (me === undefined) return null;

  if (!me) {
    return (
      <a className="steam-signin" href="/api/auth/steam">
        Sign in through Steam
      </a>
    );
  }

  return (
    <div className="auth-chip">
      {me.openMatchId && (
        <Link to="/ladder/match/$matchId" params={{ matchId: me.openMatchId }} className="match-link">
          Your match
        </Link>
      )}
      {me.isAdmin && (
        <Link to="/ladder/admin" className="navlink" activeProps={{ className: 'navlink active' }}>
          Admin
        </Link>
      )}
      <Link to="/ladder/player/$steamId" params={{ steamId: me.steamId }} className="auth-me">
        {me.avatarUrl && <img src={me.avatarUrl} alt="" width={22} height={22} />}
        <span>{me.personaName}</span>
      </Link>
      <button type="button" className="linkish" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}

-- Ladder players, one row per Steam account. Created/refreshed on Steam
-- sign-in (src/server/steam.ts + the auth callback route).
--
-- RLS is enabled with NO policies on every ladder table: the browser never
-- talks to the database, even with the anon key. All access goes through the
-- site's server functions, which use the service-role key.

create table players (
  id           uuid primary key default gen_random_uuid(),
  steam_id     text not null unique,          -- 64-bit SteamID as text
  persona_name text not null,
  avatar_url   text,
  rating       integer not null default 1000, -- see src/lib/elo.ts
  games_played integer not null default 0,
  wins         integer not null default 0,
  losses       integer not null default 0,
  is_admin     boolean not null default false,
  banned_at    timestamptz,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table players enable row level security;

-- Queue, matches and the pairing pass.
--
-- There is no long-running matchmaker: pair_queue() runs inside the database,
-- called by the queueJoin/queueStatus server functions. A transaction-scoped
-- advisory lock serialises concurrent calls from parallel serverless
-- invocations, so double-matching is impossible by construction.

create table queue_entries (
  player_id    uuid primary key references players(id) on delete cascade,
  rating       integer not null,              -- snapshot at join, used for radius matching
  joined_at    timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);

alter table queue_entries enable row level security;

create table matches (
  id                   uuid primary key default gen_random_uuid(),
  mode                 text not null default '1v1',
  status               text not null check (status in
                         ('in_progress','reported','completed','disputed','cancelled')),
  map_name             text not null,
  host_player_id       uuid not null references players(id),
  reported_by          uuid references players(id),
  reported_winner_team integer,               -- 1 | 2
  auto_confirm_at      timestamptz,           -- reported + 15 min; see finalize_due_matches()
  cancelled_by         uuid references players(id),
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);

alter table matches enable row level security;

-- Participants as rows, not player1/player2 columns, so 2v2/3v3 later is a
-- new mode value rather than a schema rewrite.
create table match_participants (
  match_id      uuid not null references matches(id) on delete cascade,
  player_id     uuid not null references players(id),
  team          integer not null,             -- 1 | 2
  rating_before integer not null,
  rating_after  integer,
  rating_delta  integer,
  outcome       text check (outcome in ('win','loss')),
  primary key (match_id, player_id)
);

create index match_participants_by_player on match_participants (player_id, match_id);

alter table match_participants enable row level security;

create table disputes (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references matches(id),
  raised_by   uuid not null references players(id),
  reason      text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolution  text
);

alter table disputes enable row level security;

-- The search radius. Mirrored in src/lib/matchmaking.ts where vitest pins it —
-- change both together. ±100 rating at join, +100 per minute waited: with a
-- small player pool everyone becomes matchable within a few minutes.
create or replace function queue_radius(joined timestamptz)
returns integer
language sql
stable
as $$
  select 100 + 100 * floor(extract(epoch from now() - joined) / 60)::integer;
$$;

-- One pairing pass. Oldest entry first, matched to the oldest partner within
-- BOTH players' radii. Returns the ids of any matches it created.
create or replace function pair_queue(map_pool text[])
returns setof uuid
language plpgsql
as $$
declare
  a           record;
  b           record;
  v_match_id  uuid;
  v_map       text;
begin
  perform pg_advisory_xact_lock(hashtext('ladder_pairing'));

  -- Entries whose tab stopped polling are dead. The 5 s status poll is the
  -- heartbeat, but browsers throttle hidden tabs' timers to once a minute, so
  -- the tolerance is 90 s: wide enough for a backgrounded-but-alive tab,
  -- narrow enough that a closed one stops ghost-matching people quickly.
  delete from queue_entries where heartbeat_at < now() - interval '90 seconds';
  delete from queue_entries qe
  where exists (
    select 1 from match_participants mp
    join matches m on m.id = mp.match_id
    where mp.player_id = qe.player_id
      and m.status in ('in_progress','reported','disputed')
  );

  for a in select * from queue_entries order by joined_at loop
    -- a may already have been paired (and deleted) earlier in this loop.
    continue when not exists (select 1 from queue_entries where player_id = a.player_id);

    select * into b from queue_entries e
    where e.player_id <> a.player_id
      and abs(e.rating - a.rating) <= least(queue_radius(a.joined_at), queue_radius(e.joined_at))
    order by e.joined_at
    limit 1;

    continue when not found;

    v_map := map_pool[1 + floor(random() * array_length(map_pool, 1))::integer];

    insert into matches (status, mode, map_name, host_player_id)
    values ('in_progress', '1v1', v_map,
            case when random() < 0.5 then a.player_id else b.player_id end)
    returning id into v_match_id;

    insert into match_participants (match_id, player_id, team, rating_before)
    values (v_match_id, a.player_id, 1, a.rating),
           (v_match_id, b.player_id, 2, b.rating);

    delete from queue_entries where player_id in (a.player_id, b.player_id);

    return next v_match_id;
  end loop;

  return;
end;
$$;

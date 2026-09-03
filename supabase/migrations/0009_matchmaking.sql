-- Auto-launch matchmaking: the in-game mod heartbeats its presence, and a
-- 1v1 pair whose players are both sitting in the game's main menu with the
-- mod running gets an `auto` match — a 10 s countdown on the site, then the
-- mods create, join and start the lobby with no human in the lobby screen.
-- Everyone else gets today's `manual` flow, untouched.
--
-- Nothing here is required for the existing site: presence is a capability
-- signal, not a gate, and every new column is nullable or defaulted.

-- ---- map paths -------------------------------------------------------------

-- The game's own path for a map (e.g. Maps/The_Forge/The_Forge.sanmap), which
-- is what the mod needs to launch it. Null means "no auto games on this map":
-- the map is still rolled for manual pairs, but an auto-capable pair only
-- rolls among maps with a path.
alter table ladder_maps add column path text;

-- ---- factions ----------------------------------------------------------------

-- What a player is willing to play as; an auto match picks one at random.
-- The game's enum names. Manual matches ignore it (players pick in the lobby).
alter table queue_entries add column factions text[] not null default '{EDA,Chosen,Guard}';

-- ---- mod sessions and presence ---------------------------------------------

-- A Steam ticket exchanged for a bearer token so the 5 s heartbeat doesn't
-- cost a Steam round-trip each time. Only the hash is stored.
create table mm_sessions (
  token_hash  text primary key,
  player_id   uuid not null references players(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

alter table mm_sessions enable row level security;

-- Last heartbeat per player: what the game is doing right now. A player is
-- launchable while seen_at is under 15 s old and state is 'menu'.
create table mod_presence (
  player_id    uuid primary key references players(id) on delete cascade,
  state        text not null check (state in ('menu', 'lobby', 'loading', 'ingame')),
  game_version text,
  mod_version  text,
  seen_at      timestamptz not null default now()
);

alter table mod_presence enable row level security;

create or replace function is_launchable(p_player uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from mod_presence
    where player_id = p_player and state = 'menu' and seen_at > now() - interval '15 seconds'
  );
$$;

-- ---- matches ----------------------------------------------------------------

-- The auto-launch lifecycle rides alongside the ladder status (which keeps
-- meaning what it always did: in_progress/reported/completed/cancelled).
--   mm_mode    auto | manual
--   mm_status  for auto: countdown | launch | cancelled | failed; null for
--              manual (the API derives 'done' from a completed match).
alter table matches
  add column mm_mode           text not null default 'manual' check (mm_mode in ('auto', 'manual')),
  add column mm_status         text check (mm_status in ('countdown', 'launch', 'cancelled', 'failed')),
  add column map_path          text,
  add column countdown_ends_at timestamptz,
  add column launched_at       timestamptz,
  add column session_id        text,      -- the host's Steam game-server id, once posted
  add column session_at        timestamptz,
  add column mm_reason         text;      -- why it fell back to manual, was cancelled, or failed

-- Per-player launch assignment for auto matches; null on manual ones.
alter table match_participants
  add column faction text check (faction in ('EDA', 'Chosen', 'Guard')),
  add column slot    integer check (slot in (1, 2));

-- What each mod reported, for the match page and the timeouts.
create table mm_events (
  id         bigserial primary key,
  match_id   uuid not null references matches(id) on delete cascade,
  player_id  uuid not null references players(id),
  type       text not null check (type in
               ('lobby_created', 'joined', 'ready', 'started', 'failed', 'left')),
  detail     text,
  created_at timestamptz not null default now()
);

create index mm_events_by_match on mm_events (match_id, id);

alter table mm_events enable row level security;

-- ---- pairing ----------------------------------------------------------------

-- Same pass as 0005 (mirrored in src/lib/matchmaking.ts — change both
-- together), plus the mode decision for 1v1 pairs: if both players are
-- launchable right now and the pool has a map with a path, the match is
-- `auto` — rolled among path-bearing maps, factions drawn from what each
-- queued as, army slots shuffled, countdown running. Otherwise `manual`.
create or replace function pair_queue(p_mode text, map_pool text[])
returns setof uuid
language plpgsql
as $$
declare
  v_size      integer := case p_mode when '1v1' then 1 when '2v2' then 2 when '3v3' then 3 end;
  v_needed    integer := v_size * 2;
  anchor      record;
  cand        record;
  v_ids       uuid[];
  v_ratings   integer[];
  v_mask      integer;
  v_best_mask integer;
  v_best_gap  integer;
  v_bits      integer;
  v_sum1      integer;
  v_sum2      integer;
  i           integer;
  v_match_id  uuid;
  v_auto      boolean;
  v_auto_pool text[];
  v_map       text;
  v_path      text;
  v_factions  text[];
  v_slot1     integer;
begin
  if v_size is null then
    raise exception 'unknown mode %', p_mode;
  end if;

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
      and m.status in ('in_progress', 'reported', 'disputed')
  );

  -- Maps in this pool the mod can launch.
  select array_agg(lm.name) into v_auto_pool
  from ladder_maps lm
  where lm.mode = p_mode and lm.enabled and lm.path is not null and lm.name = any(map_pool);

  loop
    v_match_id := null;

    for anchor in select * from queue_entries where mode = p_mode order by joined_at loop
      v_ids := array[anchor.player_id];
      v_ratings := array[anchor.rating];

      for cand in
        select * from queue_entries e
        where e.mode = p_mode
          and e.player_id <> anchor.player_id
          and abs(e.rating - anchor.rating) <= least(queue_radius(anchor.joined_at), queue_radius(e.joined_at))
        order by e.joined_at
      loop
        exit when array_length(v_ids, 1) >= v_needed;
        v_ids := v_ids || cand.player_id;
        v_ratings := v_ratings || cand.rating;
      end loop;

      continue when array_length(v_ids, 1) < v_needed;

      -- Best split: masks with bit 0 set and exactly v_size bits.
      v_best_gap := null;
      for v_mask in 1 .. (1 << v_needed) - 1 loop
        continue when (v_mask & 1) = 0;
        v_bits := 0; v_sum1 := 0; v_sum2 := 0;
        for i in 0 .. v_needed - 1 loop
          if ((v_mask >> i) & 1) = 1 then
            v_bits := v_bits + 1;
            v_sum1 := v_sum1 + v_ratings[i + 1];
          else
            v_sum2 := v_sum2 + v_ratings[i + 1];
          end if;
        end loop;
        continue when v_bits <> v_size;
        if v_best_gap is null or abs(v_sum1 - v_sum2) < v_best_gap then
          v_best_gap := abs(v_sum1 - v_sum2);
          v_best_mask := v_mask;
        end if;
      end loop;

      -- Auto only for 1v1, only when both can be launched into a game right
      -- now, and only if there's a map the mod knows the path of.
      v_auto := p_mode = '1v1'
        and v_auto_pool is not null
        and is_launchable(v_ids[1]) and is_launchable(v_ids[2]);

      if v_auto then
        v_map := v_auto_pool[1 + floor(random() * array_length(v_auto_pool, 1))::integer];
        select lm.path into v_path from ladder_maps lm where lm.mode = p_mode and lm.name = v_map;
      else
        v_map := map_pool[1 + floor(random() * array_length(map_pool, 1))::integer];
        v_path := null;
      end if;

      insert into matches (status, mode, map_name, host_player_id,
                           mm_mode, mm_status, map_path, countdown_ends_at)
      values ('in_progress', p_mode, v_map,
              v_ids[1 + floor(random() * v_needed)::integer],
              case when v_auto then 'auto' else 'manual' end,
              case when v_auto then 'countdown' end,
              v_path,
              case when v_auto then now() + interval '10 seconds' end)
      returning id into v_match_id;

      -- Slots shuffled independently of hosting, so the host doesn't get a
      -- fixed spawn.
      v_slot1 := 1 + floor(random() * 2)::integer;

      for i in 0 .. v_needed - 1 loop
        if v_auto then
          select factions into v_factions from queue_entries
          where player_id = v_ids[i + 1] and mode = p_mode;
          if v_factions is null or array_length(v_factions, 1) is null then
            v_factions := '{EDA,Chosen,Guard}';
          end if;
        end if;
        insert into match_participants (match_id, player_id, team, rating_before, faction, slot)
        values (v_match_id, v_ids[i + 1],
                case when ((v_best_mask >> i) & 1) = 1 then 1 else 2 end,
                v_ratings[i + 1],
                case when v_auto
                  then v_factions[1 + floor(random() * array_length(v_factions, 1))::integer] end,
                case when v_auto then (case when i = 0 then v_slot1 else 3 - v_slot1 end) end);
      end loop;

      -- Out of every queue, not just this mode's.
      delete from queue_entries where player_id = any(v_ids);

      return next v_match_id;
      exit; -- the queue changed; start the pass over
    end loop;

    exit when v_match_id is null;
  end loop;

  return;
end;
$$;

-- ---- the lazy sweep ----------------------------------------------------------

-- Display name for reasons.
create or replace function player_label(p_player uuid)
returns text
language sql
stable
as $$
  select coalesce(display_name, persona_name) from players where id = p_player;
$$;

-- Why a player can't be launched right now, or null if they can.
create or replace function not_launchable_reason(p_player uuid)
returns text
language sql
stable
as $$
  select case
    when pr.player_id is null or pr.seen_at <= now() - interval '15 seconds'
      then player_label(p_player) || ' closed the game'
    when pr.state = 'lobby' then player_label(p_player) || ' is in a lobby'
    when pr.state = 'loading' then player_label(p_player) || ' is loading a game'
    when pr.state = 'ingame' then player_label(p_player) || ' is in a game'
    else null
  end
  from (select p_player as id) x
  left join mod_presence pr on pr.player_id = x.id;
$$;

-- Drops an auto match back to today's manual flow, keeping the match open.
create or replace function mm_fallback_manual(p_match_id uuid, p_reason text)
returns void
language sql
as $$
  update matches set
    mm_mode = 'manual', mm_status = null, mm_reason = p_reason,
    countdown_ends_at = null, launched_at = null, session_id = null, session_at = null
  where id = p_match_id and mm_mode = 'auto' and status = 'in_progress';
$$;

-- Ends an auto match that went wrong before the game got going. The ladder
-- match is cancelled (no rating change, both free to queue again). Once both
-- sides have reported `started` the game is real and nothing the launch flow
-- says can void it any more — results and cancels go through the normal
-- match controls from there.
create or replace function mm_fail(p_match_id uuid, p_reason text)
returns void
language sql
as $$
  update matches set
    status = 'cancelled', mm_status = 'failed', mm_reason = p_reason
  where id = p_match_id and mm_mode = 'auto' and status = 'in_progress'
    and mm_status in ('countdown', 'launch')
    and (select count(distinct player_id) from mm_events
         where match_id = p_match_id and type = 'started') < 2;
$$;

-- No cron: whoever looks next (the site poll, the mod heartbeat, the match
-- page) runs this. Countdowns that hit zero launch — or fall back to manual
-- if someone stopped being launchable — and launched matches that stall fail
-- with a reason naming who stalled.
create or replace function sweep_mm_matches()
returns integer
language plpgsql
as $$
declare
  m        record;
  v_joiner uuid;
  v_reason text;
  n        integer := 0;
begin
  -- Countdown reached zero.
  for m in
    select id, host_player_id from matches
    where mm_mode = 'auto' and mm_status = 'countdown' and status = 'in_progress'
      and countdown_ends_at <= now()
    for update skip locked
  loop
    select string_agg(r, '; ') into v_reason
    from (
      select not_launchable_reason(mp.player_id) as r
      from match_participants mp where mp.match_id = m.id order by mp.team
    ) x where r is not null;

    if v_reason is null then
      update matches set mm_status = 'launch', launched_at = now() where id = m.id;
    else
      perform mm_fallback_manual(m.id, v_reason || ', so host manually');
    end if;
    n := n + 1;
  end loop;

  -- After launch.
  for m in
    select id, host_player_id, launched_at, session_id, session_at from matches
    where mm_mode = 'auto' and mm_status = 'launch' and status = 'in_progress'
    for update skip locked
  loop
    select mp.player_id into v_joiner from match_participants mp
    where mp.match_id = m.id and mp.player_id <> m.host_player_id limit 1;

    if m.session_id is null and m.launched_at < now() - interval '20 seconds' then
      perform mm_fail(m.id, player_label(m.host_player_id) || '''s game could not create a lobby');
      n := n + 1;
    elsif m.session_id is not null
      and m.session_at < now() - interval '30 seconds'
      and not exists (select 1 from mm_events e where e.match_id = m.id and e.type = 'joined') then
      perform mm_fail(m.id, player_label(v_joiner) || ' didn''t join the lobby');
      n := n + 1;
    elsif m.launched_at < now() - interval '60 seconds'
      and (select count(distinct player_id) from mm_events e where e.match_id = m.id and e.type = 'started') < 2 then
      perform mm_fail(m.id, 'The game didn''t start');
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

-- Sessions don't need a sweep of their own; expired rows go when anyone mints.

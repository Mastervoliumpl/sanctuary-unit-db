-- Team modes: per-mode ratings, per-mode queues, team-aware pairing and Elo,
-- the post-window cancel handshake, and the admin flag.
--
-- Applied while the previous code is still live, so it's additive: the old
-- rating columns on players stay (0006 drops them once the new code is
-- deployed), and pair_queue keeps a one-argument overload for the old
-- caller. Nothing here breaks the running site.

-- ---- ratings per mode ------------------------------------------------------

create table player_ratings (
  player_id    uuid not null references players(id) on delete cascade,
  mode         text not null check (mode in ('1v1', '2v2', '3v3')),
  rating       integer not null default 1000,
  games_played integer not null default 0,
  wins         integer not null default 0,
  losses       integer not null default 0,
  primary key (player_id, mode)
);

alter table player_ratings enable row level security;

-- Everyone's current 1v1 standing carries over untouched.
insert into player_ratings (player_id, mode, rating, games_played, wins, losses)
select id, '1v1', rating, games_played, wins, losses from players;

create or replace function ensure_rating(p_player uuid, p_mode text)
returns void
language sql
as $$
  insert into player_ratings (player_id, mode) values (p_player, p_mode)
  on conflict do nothing;
$$;

-- ---- queues per mode -------------------------------------------------------

alter table queue_entries add column mode text not null default '1v1'
  check (mode in ('1v1', '2v2', '3v3'));
alter table queue_entries drop constraint queue_entries_pkey;
alter table queue_entries add primary key (player_id, mode);
-- The pre-modes code upserts `on conflict (player_id)`, which needs this
-- unique constraint to exist until it's replaced. It also means one queue per
-- player until 0006 drops it — multi-queue switches on then.
alter table queue_entries add constraint queue_entries_single_mode_tmp unique (player_id);

-- ---- matches ---------------------------------------------------------------

alter table matches add constraint matches_mode_check check (mode in ('1v1', '2v2', '3v3'));
-- After the free-cancel window, cancelling takes one request from each side.
alter table matches add column cancel_requested_by uuid references players(id);

-- ---- admin -----------------------------------------------------------------

update players set is_admin = true where steam_id = '76561198017050831';

-- ---- pairing ---------------------------------------------------------------

-- One matchmaking pass for a mode. Mirrored in src/lib/matchmaking.ts
-- (formGroups + bestSplit), where vitest pins it — change both together.
--
-- Each waiter in turn (oldest first) anchors a group of the oldest candidates
-- inside its mutual radius; the first anchor that gathers enough forms a
-- game, balanced by trying every team partition (player 0 pinned to team 1)
-- and keeping the smallest gap between team rating sums. Formed players
-- leave EVERY queue they were in. Repeats until no group forms.
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

      insert into matches (status, mode, map_name, host_player_id)
      values ('in_progress', p_mode,
              map_pool[1 + floor(random() * array_length(map_pool, 1))::integer],
              v_ids[1 + floor(random() * v_needed)::integer])
      returning id into v_match_id;

      for i in 0 .. v_needed - 1 loop
        insert into match_participants (match_id, player_id, team, rating_before)
        values (v_match_id, v_ids[i + 1],
                case when ((v_best_mask >> i) & 1) = 1 then 1 else 2 end,
                v_ratings[i + 1]);
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

-- Compatibility overload for the pre-modes code path (1v1 only). Dropped in
-- 0006.
create or replace function pair_queue(map_pool text[])
returns setof uuid
language sql
as $$
  select pair_queue('1v1', map_pool);
$$;

-- ---- results ---------------------------------------------------------------

-- Applies a reported result for any mode. Transcription of applyTeamResult
-- in src/lib/elo.ts (start 1000, K=40 for the first 10 games in the mode then
-- 20, floor 100; each player's expected score is against the OPPOSING team's
-- average rating). Idempotent: does nothing unless the match is 'reported'.
create or replace function apply_match_result(p_match_id uuid, p_winner_team integer)
returns void
language plpgsql
as $$
declare
  v_match    matches%rowtype;
  v_win_avg  numeric;
  v_lose_avg numeric;
  p          record;
  v_expected numeric;
  v_k        integer;
  v_after    integer;
begin
  select * into v_match from matches where id = p_match_id for update;
  if not found or v_match.status <> 'reported' then
    return;
  end if;

  insert into player_ratings (player_id, mode)
  select player_id, v_match.mode from match_participants where match_id = p_match_id
  on conflict do nothing;

  select avg(pr.rating) into v_win_avg
    from match_participants mp join player_ratings pr on pr.player_id = mp.player_id and pr.mode = v_match.mode
   where mp.match_id = p_match_id and mp.team = p_winner_team;
  select avg(pr.rating) into v_lose_avg
    from match_participants mp join player_ratings pr on pr.player_id = mp.player_id and pr.mode = v_match.mode
   where mp.match_id = p_match_id and mp.team <> p_winner_team;

  for p in
    select mp.player_id, mp.team, pr.rating, pr.games_played
      from match_participants mp join player_ratings pr on pr.player_id = mp.player_id and pr.mode = v_match.mode
     where mp.match_id = p_match_id
  loop
    v_k := case when p.games_played < 10 then 40 else 20 end;
    if p.team = p_winner_team then
      v_expected := 1 / (1 + power(10, (v_lose_avg - p.rating) / 400.0));
      v_after := greatest(100, p.rating + round(v_k * (1 - v_expected))::integer);
      update match_participants set outcome = 'win', rating_after = v_after, rating_delta = v_after - p.rating
       where match_id = p_match_id and player_id = p.player_id;
      update player_ratings set rating = v_after, games_played = games_played + 1, wins = wins + 1
       where player_id = p.player_id and mode = v_match.mode;
    else
      v_expected := 1 / (1 + power(10, (v_win_avg - p.rating) / 400.0));
      v_after := greatest(100, p.rating - round(v_k * v_expected)::integer);
      update match_participants set outcome = 'loss', rating_after = v_after, rating_delta = v_after - p.rating
       where match_id = p_match_id and player_id = p.player_id;
      update player_ratings set rating = v_after, games_played = games_played + 1, losses = losses + 1
       where player_id = p.player_id and mode = v_match.mode;
    end if;
  end loop;

  -- Keep the legacy 1v1 columns in step until 0006 drops them.
  if v_match.mode = '1v1' then
    update players p set
      rating = pr.rating, games_played = pr.games_played, wins = pr.wins, losses = pr.losses
    from player_ratings pr
    where pr.player_id = p.id and pr.mode = '1v1'
      and p.id in (select player_id from match_participants where match_id = p_match_id);
  end if;

  update matches set status = 'completed', completed_at = now() where id = p_match_id;
end;
$$;

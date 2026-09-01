-- Result finalisation: Elo application and the lazy auto-confirm sweep.
--
-- The Elo maths here is a transcription of src/lib/elo.ts, where vitest pins
-- the constants (start 1000, K=40 for the first 10 games then 20, floor 100).
-- Change both together.

-- Applies a reported result. Idempotent: does nothing unless the match is in
-- 'reported'. Ratings are read from players (authoritative at finalisation —
-- a player can only have one open match, so they cannot have drifted since
-- the match was created).
create or replace function apply_match_result(p_match_id uuid, p_winner_team integer)
returns void
language plpgsql
as $$
declare
  v_match    matches%rowtype;
  v_winner   record;
  v_loser    record;
  v_expected numeric;   -- winner's expected score
  v_w_after  integer;
  v_l_after  integer;
begin
  select * into v_match from matches where id = p_match_id for update;
  if not found or v_match.status <> 'reported' then
    return;
  end if;

  select mp.player_id, mp.team, p.rating, p.games_played
    into v_winner
    from match_participants mp join players p on p.id = mp.player_id
   where mp.match_id = p_match_id and mp.team = p_winner_team;

  select mp.player_id, mp.team, p.rating, p.games_played
    into v_loser
    from match_participants mp join players p on p.id = mp.player_id
   where mp.match_id = p_match_id and mp.team <> p_winner_team;

  v_expected := 1 / (1 + power(10, (v_loser.rating - v_winner.rating) / 400.0));

  v_w_after := greatest(100, v_winner.rating +
    round((case when v_winner.games_played < 10 then 40 else 20 end) * (1 - v_expected))::integer);
  v_l_after := greatest(100, v_loser.rating -
    round((case when v_loser.games_played < 10 then 40 else 20 end) * (1 - v_expected))::integer);

  update match_participants set
    outcome      = 'win',
    rating_after = v_w_after,
    rating_delta = v_w_after - v_winner.rating
  where match_id = p_match_id and player_id = v_winner.player_id;

  update match_participants set
    outcome      = 'loss',
    rating_after = v_l_after,
    rating_delta = v_l_after - v_loser.rating
  where match_id = p_match_id and player_id = v_loser.player_id;

  update players set
    rating       = v_w_after,
    games_played = games_played + 1,
    wins         = wins + 1
  where id = v_winner.player_id;

  update players set
    rating       = v_l_after,
    games_played = games_played + 1,
    losses       = losses + 1
  where id = v_loser.player_id;

  update matches set
    status       = 'completed',
    completed_at = now()
  where id = p_match_id;
end;
$$;

-- Auto-confirm without a cron: reported matches whose 15-minute window has
-- lapsed are finalised by whoever looks next (queueStatus, matchGet and
-- leaderboard all call this first).
create or replace function finalize_due_matches()
returns integer
language plpgsql
as $$
declare
  m record;
  n integer := 0;
begin
  for m in
    select id, reported_winner_team from matches
    where status = 'reported' and auto_confirm_at < now()
  loop
    perform apply_match_result(m.id, m.reported_winner_team);
    n := n + 1;
  end loop;
  return n;
end;
$$;

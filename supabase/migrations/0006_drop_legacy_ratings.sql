-- Apply only after the modes code (0005's counterpart) is deployed: removes
-- the pre-modes rating columns and the pair_queue compatibility overload.

drop function if exists pair_queue(text[]);

-- Multi-queue: a player may now wait in several modes at once.
alter table queue_entries drop constraint queue_entries_single_mode_tmp;

alter table players
  drop column rating,
  drop column games_played,
  drop column wins,
  drop column losses;

-- apply_match_result no longer needs to mirror into players.
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

  update matches set status = 'completed', completed_at = now() where id = p_match_id;
end;
$$;

-- Admin deletion of a match, for test games that shouldn't count.
--
-- An open match just goes away (no ratings were touched). A completed one
-- has its recorded rating changes reversed first: each participant gets
-- their delta undone and the game removed from their W/L/games — as recorded
-- at the time; later games are not recomputed, which is exactly right for
-- "this test game shouldn't have counted".

create or replace function admin_delete_match(p_match_id uuid)
returns void
language plpgsql
as $$
declare
  v_match matches%rowtype;
  p       record;
begin
  select * into v_match from matches where id = p_match_id for update;
  if not found then
    return;
  end if;

  if v_match.status = 'completed' then
    for p in
      select player_id, outcome, rating_delta from match_participants where match_id = p_match_id
    loop
      update player_ratings set
        rating       = rating - coalesce(p.rating_delta, 0),
        games_played = greatest(0, games_played - 1),
        wins         = greatest(0, wins - case when p.outcome = 'win' then 1 else 0 end),
        losses       = greatest(0, losses - case when p.outcome = 'loss' then 1 else 0 end)
      where player_id = p.player_id and mode = v_match.mode;
    end loop;
  end if;

  delete from disputes where match_id = p_match_id;
  delete from matches where id = p_match_id; -- participants cascade
end;
$$;

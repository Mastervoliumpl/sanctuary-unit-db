-- Why a 1v1 pair went manual, recorded at pairing time.
--
-- The first live test produced manual matches with no explanation: the
-- decision is made from the two players' last heartbeats and the map pool,
-- none of which is visible afterwards (presence rows are overwritten every
-- 5 s). So pair_queue now writes mm_reason whenever a 1v1 pair could have
-- been auto but wasn't — a player without the mod, a stale heartbeat (with
-- its age), a player not in the menu, or no map in the pool with a path.
-- Only when at least one side had the mod running, so the ordinary
-- everyone-manual case stays silent.

-- Sharper wording, with the heartbeat age when the mod was there but went
-- quiet — that separates "closed the game" from "the poll stalled".
create or replace function not_launchable_reason(p_player uuid)
returns text
language sql
stable
as $$
  select case
    when pr.player_id is null
      then player_label(p_player) || ' isn''t running the mod'
    when pr.seen_at <= now() - interval '15 seconds'
      then player_label(p_player) || '''s last heartbeat was '
           || extract(epoch from now() - pr.seen_at)::integer || ' s old'
    when pr.state = 'lobby' then player_label(p_player) || ' is in a lobby'
    when pr.state = 'loading' then player_label(p_player) || ' is loading a game'
    when pr.state = 'ingame' then player_label(p_player) || ' is in a game'
    else null
  end
  from (select p_player as id) x
  left join mod_presence pr on pr.player_id = x.id;
$$;

-- Same pass as 0009 (mirrored in src/lib/matchmaking.ts — change both
-- together), plus mm_reason on 1v1 manual pairs.
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
  v_reason    text;
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

      -- Why not, when someone was at least trying (a heartbeat in the last
      -- minute): the players' reasons, else the pool's.
      v_reason := null;
      if p_mode = '1v1' and not v_auto and exists (
        select 1 from mod_presence
        where player_id = any(v_ids) and seen_at > now() - interval '60 seconds'
      ) then
        select string_agg(r, '; ') into v_reason
        from (
          select not_launchable_reason(id) as r
          from unnest(v_ids) as id
        ) x where r is not null;
        if v_reason is null then
          v_reason := 'no map in the 1v1 pool has a path set';
        end if;
      end if;

      if v_auto then
        v_map := v_auto_pool[1 + floor(random() * array_length(v_auto_pool, 1))::integer];
        select lm.path into v_path from ladder_maps lm where lm.mode = p_mode and lm.name = v_map;
      else
        v_map := map_pool[1 + floor(random() * array_length(map_pool, 1))::integer];
        v_path := null;
      end if;

      insert into matches (status, mode, map_name, host_player_id,
                           mm_mode, mm_status, map_path, countdown_ends_at, mm_reason)
      values ('in_progress', p_mode, v_map,
              v_ids[1 + floor(random() * v_needed)::integer],
              case when v_auto then 'auto' else 'manual' end,
              case when v_auto then 'countdown' end,
              v_path,
              case when v_auto then now() + interval '10 seconds' end,
              v_reason)
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

-- One round trip for everything time-driven (the heartbeat calls this on
-- every poll, so it pays to be a single statement).
create or replace function sweep_all()
returns void
language sql
as $$
  select finalize_due_matches();
  select sweep_mm_matches();
$$;

-- ---- shipped map paths ------------------------------------------------------

-- Every map the game ships, name -> path, as read from the install. Applied
-- to the pool by name (case-insensitively: the pool says "Two step shuffle",
-- the game "Two Step Shuffle"); the admin page can still override a path.
-- Kept as a table so a map added to a pool later picks its path up too
-- (see adminMapSave).

create table if not exists shipped_maps (
  name text primary key,
  path text not null
);

alter table shipped_maps enable row level security;

insert into shipped_maps (name, path) values
  ('Alpha 7 Quarantine', 'Maps/Alpha_7_Quarantine/Alpha_7_Quarantine.sanmap'),
  ('Ambush Pass', 'Maps/Ambush_Pass/Ambush_Pass.sanmap'),
  ('Arctic Refuge', 'Maps/Arctic_Refuge/Arctic_Refuge.sanmap'),
  ('Blasted Rock', 'Maps/Blasted_Rock/Blasted_Rock.sanmap'),
  ('Burial Mounds', 'Maps/Burial_Mounds/Burial_Mounds.sanmap'),
  ('Canis River', 'Maps/Canis_River/Canis_River.sanmap'),
  ('Concord Lake', 'Maps/Concord_Lake/Concord_Lake.sanmap'),
  ('Crag Dunes', 'Maps/Crag_Dunes/Crag_Dunes.sanmap'),
  ('Crossfire Canal', 'Maps/Crossfire_Canal/Crossfire_Canal.sanmap'),
  ('Daroza s Sanctuary', 'Maps/Daroza_s_Sanctuary/Daroza_s_Sanctuary.sanmap'),
  ('Drake s Ravine', 'Maps/Drake_s_Ravine/Drake_s_Ravine.sanmap'),
  ('Emerald Crater', 'Maps/Emerald_Crater/Emerald_Crater.sanmap'),
  ('Eye of the Storm', 'Maps/Eye_of_the_Storm/Eye_of_the_Storm.sanmap'),
  ('Fields of Isis', 'Maps/Fields_of_Isis/Fields_of_Isis.sanmap'),
  ('Finn s Revenge', 'Maps/Finn_s_Revenge/Finn_s_Revenge.sanmap'),
  ('Flooded Strip Mine', 'Maps/Flooded_Strip_Mine/Flooded_Strip_Mine.sanmap'),
  ('Four Corners', 'Maps/Four_Corners/Four_Corners.sanmap'),
  ('Four Leaf Clover', 'Maps/Four_Leaf_Clover/Four_Leaf_Clover.sanmap'),
  ('Gentleman s Reef', 'Maps/Gentleman_s_Reef/Gentleman_s_Reef.sanmap'),
  ('Hanna Oasis', 'Maps/Hanna_Oasis/Hanna_Oasis.sanmap'),
  ('Haven Reef', 'Maps/Haven_Reef/Haven_Reef.sanmap'),
  ('High Noon', 'Maps/High_Noon/High_Noon.sanmap'),
  ('Ian s Cross', 'Maps/Ian_s_Cross/Ian_s_Cross.sanmap'),
  ('Liberiam Battles', 'Maps/Liberiam_Battles/Liberiam_Battles.sanmap'),
  ('Open Palms', 'Maps/Open_Palms/Open_Palms.sanmap'),
  ('Paradise', 'Maps/Paradise/Paradise.sanmap'),
  ('Roanoke Abyss', 'Maps/Roanoke_Abyss/Roanoke_Abyss.sanmap'),
  ('Saltrock Colony', 'Maps/Saltrock_Colony/Saltrock_Colony.sanmap'),
  ('Sentry Point', 'Maps/Sentry_Point/Sentry_Point.sanmap'),
  ('Seraphim Glaciers', 'Maps/Seraphim_Glaciers/Seraphim_Glaciers.sanmap'),
  ('Seton s Clutch', 'Maps/Seton_s_Clutch/Seton_s_Clutch.sanmap'),
  ('Shards', 'Maps/Shards/Shards.sanmap'),
  ('Shuriken Island', 'Maps/Shuriken_Island/Shuriken_Island.sanmap'),
  ('Sludge', 'Maps/Sludge/Sludge.sanmap'),
  ('Snoey Triangle', 'Maps/Snoey_Triangle/Snoey_Triangle.sanmap'),
  ('Strip Mine', 'Maps/Strip_Mine/Strip_Mine.sanmap'),
  ('Sung Island', 'Maps/Sung_Island/Sung_Island.sanmap'),
  ('Syrtis Major', 'Maps/Syrtis_Major/Syrtis_Major.sanmap'),
  ('Thawing Glacier', 'Maps/Thawing_Glacier/Thawing_Glacier.sanmap'),
  ('The Bermuda Locket', 'Maps/The_Bermuda_Locket/The_Bermuda_Locket.sanmap'),
  ('The Dark Heart', 'Maps/The_Dark_Heart/The_Dark_Heart.sanmap'),
  ('The Ditch', 'Maps/The_Ditch/The_Ditch.sanmap'),
  ('The Forge', 'Maps/The_Forge/The_Forge.sanmap'),
  ('The Forge Survival Brutal', 'Maps/The_Forge_Survival_Brutal/The_Forge_Survival_Brutal.sanmap'),
  ('The Forge Survival Easy', 'Maps/The_Forge_Survival_Easy/The_Forge_Survival_Easy.sanmap'),
  ('The Forge Survival God Gamer', 'Maps/The_Forge_Survival_God_Gamer/The_Forge_Survival_God_Gamer.sanmap'),
  ('The Forge Survival Hard', 'Maps/The_Forge_Survival_Hard/The_Forge_Survival_Hard.sanmap'),
  ('The Forge Survival Insane', 'Maps/The_Forge_Survival_Insane/The_Forge_Survival_Insane.sanmap'),
  ('The Forge Survival Nightmare', 'Maps/The_Forge_Survival_Nightmare/The_Forge_Survival_Nightmare.sanmap'),
  ('The Forge Survival Normal', 'Maps/The_Forge_Survival_Normal/The_Forge_Survival_Normal.sanmap'),
  ('The Forge Survival Very Hard', 'Maps/The_Forge_Survival_Very_Hard/The_Forge_Survival_Very_Hard.sanmap'),
  ('The Great Void', 'Maps/The_Great_Void/The_Great_Void.sanmap'),
  ('The Scar', 'Maps/The_Scar/The_Scar.sanmap'),
  ('The Wilderness', 'Maps/The_Wilderness/The_Wilderness.sanmap'),
  ('There Is Time', 'Maps/There_Is_Time/There_Is_Time.sanmap'),
  ('There Is Time Survival Brutal', 'Maps/There_Is_Time_Survival_Brutal/There_Is_Time_Survival_Brutal.sanmap'),
  ('There Is Time Survival Easy', 'Maps/There_Is_Time_Survival_Easy/There_Is_Time_Survival_Easy.sanmap'),
  ('There Is Time Survival God Gamer', 'Maps/There_Is_Time_Survival_God_Gamer/There_Is_Time_Survival_God_Gamer.sanmap'),
  ('There Is Time Survival Hard', 'Maps/There_Is_Time_Survival_Hard/There_Is_Time_Survival_Hard.sanmap'),
  ('There Is Time Survival Insane', 'Maps/There_Is_Time_Survival_Insane/There_Is_Time_Survival_Insane.sanmap'),
  ('There Is Time Survival Nightmare', 'Maps/There_Is_Time_Survival_Nightmare/There_Is_Time_Survival_Nightmare.sanmap'),
  ('There Is Time Survival Normal', 'Maps/There_Is_Time_Survival_Normal/There_Is_Time_Survival_Normal.sanmap'),
  ('There Is Time Survival Very Hard', 'Maps/There_Is_Time_Survival_Very_Hard/There_Is_Time_Survival_Very_Hard.sanmap'),
  ('Theta Passage', 'Maps/Theta_Passage/Theta_Passage.sanmap'),
  ('Two Step Shuffle', 'Maps/Two_Step_Shuffle/Two_Step_Shuffle.sanmap'),
  ('Varga Pass', 'Maps/Varga_Pass/Varga_Pass.sanmap'),
  ('Vya 3 Protectorate', 'Maps/Vya_3_Protectorate/Vya_3_Protectorate.sanmap'),
  ('White Desert', 'Maps/White_Desert/White_Desert.sanmap'),
  ('White Desert Survival Brutal', 'Maps/White_Desert_Survival_Brutal/White_Desert_Survival_Brutal.sanmap'),
  ('White Desert Survival Easy', 'Maps/White_Desert_Survival_Easy/White_Desert_Survival_Easy.sanmap'),
  ('White Desert Survival God Gamer', 'Maps/White_Desert_Survival_God_Gamer/White_Desert_Survival_God_Gamer.sanmap'),
  ('White Desert Survival Hard', 'Maps/White_Desert_Survival_Hard/White_Desert_Survival_Hard.sanmap'),
  ('White Desert Survival Insane', 'Maps/White_Desert_Survival_Insane/White_Desert_Survival_Insane.sanmap'),
  ('White Desert Survival Nightmare', 'Maps/White_Desert_Survival_Nightmare/White_Desert_Survival_Nightmare.sanmap'),
  ('White Desert Survival Normal', 'Maps/White_Desert_Survival_Normal/White_Desert_Survival_Normal.sanmap'),
  ('White Desert Survival Very Hard', 'Maps/White_Desert_Survival_Very_Hard/White_Desert_Survival_Very_Hard.sanmap'),
  ('White Fire', 'Maps/White_Fire/White_Fire.sanmap'),
  ('Williamson s Bridge', 'Maps/Williamson_s_Bridge/Williamson_s_Bridge.sanmap'),
  ('Winter Duel', 'Maps/Winter_Duel/Winter_Duel.sanmap'),
  ('~FFA-10P_Desert_2048_41324', 'Maps/~FFA-10P_Desert_2048_41324/~FFA-10P_Desert_2048_41324.sanmap'),
  ('~FFA-12P_Tropical_2048_80433', 'Maps/~FFA-12P_Tropical_2048_80433/~FFA-12P_Tropical_2048_80433.sanmap'),
  ('~FFA-16P_Desert_2048_29390', 'Maps/~FFA-16P_Desert_2048_29390/~FFA-16P_Desert_2048_29390.sanmap'),
  ('~FFA-16P_Frozen_2048_4945', 'Maps/~FFA-16P_Frozen_2048_4945/~FFA-16P_Frozen_2048_4945.sanmap'),
  ('~FFA-16P_Tropical_2048_20299', 'Maps/~FFA-16P_Tropical_2048_20299/~FFA-16P_Tropical_2048_20299.sanmap'),
  ('~FFA-16P_Tropical_2048_51607', 'Maps/~FFA-16P_Tropical_2048_51607/~FFA-16P_Tropical_2048_51607.sanmap'),
  ('~FFA-3P_Frozen_512_44530', 'Maps/~FFA-3P_Frozen_512_44530/~FFA-3P_Frozen_512_44530.sanmap'),
  ('~FFA-3P_Tropical_256_95220', 'Maps/~FFA-3P_Tropical_256_95220/~FFA-3P_Tropical_256_95220.sanmap'),
  ('~FFA-3P_Tropical_512_24245', 'Maps/~FFA-3P_Tropical_512_24245/~FFA-3P_Tropical_512_24245.sanmap'),
  ('~FFA-4P_Desert_512_74685', 'Maps/~FFA-4P_Desert_512_74685/~FFA-4P_Desert_512_74685.sanmap'),
  ('~FFA-4P_Forest_1024_45657', 'Maps/~FFA-4P_Forest_1024_45657/~FFA-4P_Forest_1024_45657.sanmap'),
  ('~FFA-4P_Forest_512_59379', 'Maps/~FFA-4P_Forest_512_59379/~FFA-4P_Forest_512_59379.sanmap'),
  ('~FFA-4P_Frozen_1024_3511', 'Maps/~FFA-4P_Frozen_1024_3511/~FFA-4P_Frozen_1024_3511.sanmap'),
  ('~FFA-4P_Frozen_512_59439', 'Maps/~FFA-4P_Frozen_512_59439/~FFA-4P_Frozen_512_59439.sanmap'),
  ('~FFA-4P_Tropical_512_51', 'Maps/~FFA-4P_Tropical_512_51/~FFA-4P_Tropical_512_51.sanmap'),
  ('~FFA-6P_Frozen_1024_76663', 'Maps/~FFA-6P_Frozen_1024_76663/~FFA-6P_Frozen_1024_76663.sanmap'),
  ('~FFA-6P_Tropical_1024_1253', 'Maps/~FFA-6P_Tropical_1024_1253/~FFA-6P_Tropical_1024_1253.sanmap'),
  ('~FFA-7P_Forest_1024_73921', 'Maps/~FFA-7P_Forest_1024_73921/~FFA-7P_Forest_1024_73921.sanmap'),
  ('~FFA-7P_Forest_1024_97320', 'Maps/~FFA-7P_Forest_1024_97320/~FFA-7P_Forest_1024_97320.sanmap'),
  ('~FFA-8P_Desert_1024_28423', 'Maps/~FFA-8P_Desert_1024_28423/~FFA-8P_Desert_1024_28423.sanmap'),
  ('~FFA-8P_Desert_2048_43186', 'Maps/~FFA-8P_Desert_2048_43186/~FFA-8P_Desert_2048_43186.sanmap'),
  ('~FFA-8P_Forest_1024_60309', 'Maps/~FFA-8P_Forest_1024_60309/~FFA-8P_Forest_1024_60309.sanmap'),
  ('~FFA-8P_Frozen_1024_65717', 'Maps/~FFA-8P_Frozen_1024_65717/~FFA-8P_Frozen_1024_65717.sanmap'),
  ('~FFA-8P_Frozen_2048_13140', 'Maps/~FFA-8P_Frozen_2048_13140/~FFA-8P_Frozen_2048_13140.sanmap'),
  ('~TEAM-1v1_Desert_512_23678', 'Maps/~TEAM-1v1_Desert_512_23678/~TEAM-1v1_Desert_512_23678.sanmap'),
  ('~TEAM-1v1_Desert_512_89065', 'Maps/~TEAM-1v1_Desert_512_89065/~TEAM-1v1_Desert_512_89065.sanmap'),
  ('~TEAM-1v1_Forest_512_28589', 'Maps/~TEAM-1v1_Forest_512_28589/~TEAM-1v1_Forest_512_28589.sanmap'),
  ('~TEAM-1v1_Tropical_256_47940', 'Maps/~TEAM-1v1_Tropical_256_47940/~TEAM-1v1_Tropical_256_47940.sanmap'),
  ('~TEAM-1v1_Tropical_256_92536', 'Maps/~TEAM-1v1_Tropical_256_92536/~TEAM-1v1_Tropical_256_92536.sanmap'),
  ('~TEAM-1v1_Tropical_512_11446', 'Maps/~TEAM-1v1_Tropical_512_11446/~TEAM-1v1_Tropical_512_11446.sanmap'),
  ('~TEAM-2v2_Desert_512_488', 'Maps/~TEAM-2v2_Desert_512_488/~TEAM-2v2_Desert_512_488.sanmap'),
  ('~TEAM-2v2_Forest_512_59807', 'Maps/~TEAM-2v2_Forest_512_59807/~TEAM-2v2_Forest_512_59807.sanmap'),
  ('~TEAM-2v2_Forest_512_83539', 'Maps/~TEAM-2v2_Forest_512_83539/~TEAM-2v2_Forest_512_83539.sanmap'),
  ('~TEAM-2v2_Frozen_256_25896', 'Maps/~TEAM-2v2_Frozen_256_25896/~TEAM-2v2_Frozen_256_25896.sanmap'),
  ('~TEAM-2v2_Frozen_512_23540', 'Maps/~TEAM-2v2_Frozen_512_23540/~TEAM-2v2_Frozen_512_23540.sanmap'),
  ('~TEAM-2v2_Tropical_512_40046', 'Maps/~TEAM-2v2_Tropical_512_40046/~TEAM-2v2_Tropical_512_40046.sanmap'),
  ('~TEAM-2v2v2_Desert_512_62120', 'Maps/~TEAM-2v2v2_Desert_512_62120/~TEAM-2v2v2_Desert_512_62120.sanmap'),
  ('~TEAM-2v2v2_Tropical_512_46297', 'Maps/~TEAM-2v2v2_Tropical_512_46297/~TEAM-2v2v2_Tropical_512_46297.sanmap'),
  ('~TEAM-2v2v2v2_Desert_1024_20775', 'Maps/~TEAM-2v2v2v2_Desert_1024_20775/~TEAM-2v2v2v2_Desert_1024_20775.sanmap'),
  ('~TEAM-2v2v2v2_Forest_1024_64331', 'Maps/~TEAM-2v2v2v2_Forest_1024_64331/~TEAM-2v2v2v2_Forest_1024_64331.sanmap'),
  ('~TEAM-2v2v2v2_Forest_1024_88646', 'Maps/~TEAM-2v2v2v2_Forest_1024_88646/~TEAM-2v2v2v2_Forest_1024_88646.sanmap'),
  ('~TEAM-2v2v2v2_Frozen_2048_89705', 'Maps/~TEAM-2v2v2v2_Frozen_2048_89705/~TEAM-2v2v2v2_Frozen_2048_89705.sanmap'),
  ('~TEAM-3v3_Desert_512_67497', 'Maps/~TEAM-3v3_Desert_512_67497/~TEAM-3v3_Desert_512_67497.sanmap'),
  ('~TEAM-3v3_Forest_512_22736', 'Maps/~TEAM-3v3_Forest_512_22736/~TEAM-3v3_Forest_512_22736.sanmap'),
  ('~TEAM-3v3_Frozen_1024_42354', 'Maps/~TEAM-3v3_Frozen_1024_42354/~TEAM-3v3_Frozen_1024_42354.sanmap'),
  ('~TEAM-3v3_Frozen_512_52755', 'Maps/~TEAM-3v3_Frozen_512_52755/~TEAM-3v3_Frozen_512_52755.sanmap'),
  ('~TEAM-3v3_Tropical_1024_24230', 'Maps/~TEAM-3v3_Tropical_1024_24230/~TEAM-3v3_Tropical_1024_24230.sanmap'),
  ('~TEAM-3v3_Tropical_512_36001', 'Maps/~TEAM-3v3_Tropical_512_36001/~TEAM-3v3_Tropical_512_36001.sanmap'),
  ('~TEAM-3v3v3_Desert_512_54392', 'Maps/~TEAM-3v3v3_Desert_512_54392/~TEAM-3v3v3_Desert_512_54392.sanmap'),
  ('~TEAM-3v3v3_Tropical_1024_14958', 'Maps/~TEAM-3v3v3_Tropical_1024_14958/~TEAM-3v3v3_Tropical_1024_14958.sanmap'),
  ('~TEAM-3v3v3_Tropical_1024_87329', 'Maps/~TEAM-3v3v3_Tropical_1024_87329/~TEAM-3v3v3_Tropical_1024_87329.sanmap'),
  ('~TEAM-4v4_Desert_2048_18852', 'Maps/~TEAM-4v4_Desert_2048_18852/~TEAM-4v4_Desert_2048_18852.sanmap'),
  ('~TEAM-4v4_Desert_2048_72241', 'Maps/~TEAM-4v4_Desert_2048_72241/~TEAM-4v4_Desert_2048_72241.sanmap'),
  ('~TEAM-4v4_Forest_1024_48908', 'Maps/~TEAM-4v4_Forest_1024_48908/~TEAM-4v4_Forest_1024_48908.sanmap'),
  ('~TEAM-4v4_Frozen_1024_11449', 'Maps/~TEAM-4v4_Frozen_1024_11449/~TEAM-4v4_Frozen_1024_11449.sanmap'),
  ('~TEAM-4v4_Frozen_2048_20303', 'Maps/~TEAM-4v4_Frozen_2048_20303/~TEAM-4v4_Frozen_2048_20303.sanmap'),
  ('~TEAM-4v4_Frozen_2048_75501', 'Maps/~TEAM-4v4_Frozen_2048_75501/~TEAM-4v4_Frozen_2048_75501.sanmap'),
  ('~TEAM-4v4_Tropical_1024_22278', 'Maps/~TEAM-4v4_Tropical_1024_22278/~TEAM-4v4_Tropical_1024_22278.sanmap'),
  ('~TEAM-4v4v4_Forest_1024_23120', 'Maps/~TEAM-4v4v4_Forest_1024_23120/~TEAM-4v4v4_Forest_1024_23120.sanmap'),
  ('~TEAM-4v4v4_Frozen_1024_72975', 'Maps/~TEAM-4v4v4_Frozen_1024_72975/~TEAM-4v4v4_Frozen_1024_72975.sanmap'),
  ('~TEAM-4v4v4_Tropical_1024_98537', 'Maps/~TEAM-4v4v4_Tropical_1024_98537/~TEAM-4v4v4_Tropical_1024_98537.sanmap'),
  ('~TEAM-4v4v4v4_Desert_2048_56780', 'Maps/~TEAM-4v4v4v4_Desert_2048_56780/~TEAM-4v4v4v4_Desert_2048_56780.sanmap'),
  ('~TEAM-4v4v4v4_Forest_2048_94696', 'Maps/~TEAM-4v4v4v4_Forest_2048_94696/~TEAM-4v4v4v4_Forest_2048_94696.sanmap'),
  ('~TEAM-4v4v4v4_Frozen_1024_53761', 'Maps/~TEAM-4v4v4v4_Frozen_1024_53761/~TEAM-4v4v4v4_Frozen_1024_53761.sanmap'),
  ('~TEAM-4v4v4v4_Frozen_2048_186', 'Maps/~TEAM-4v4v4v4_Frozen_2048_186/~TEAM-4v4v4v4_Frozen_2048_186.sanmap'),
  ('~TEAM-8v8_Desert_2048_28017', 'Maps/~TEAM-8v8_Desert_2048_28017/~TEAM-8v8_Desert_2048_28017.sanmap'),
  ('~TEAM-8v8_Desert_2048_3957', 'Maps/~TEAM-8v8_Desert_2048_3957/~TEAM-8v8_Desert_2048_3957.sanmap'),
  ('~TEAM-8v8_Desert_2048_61114', 'Maps/~TEAM-8v8_Desert_2048_61114/~TEAM-8v8_Desert_2048_61114.sanmap'),
  ('~TEAM-8v8_Forest_2048_41150', 'Maps/~TEAM-8v8_Forest_2048_41150/~TEAM-8v8_Forest_2048_41150.sanmap'),
  ('~TEAM-8v8_Tropical_2048_46361', 'Maps/~TEAM-8v8_Tropical_2048_46361/~TEAM-8v8_Tropical_2048_46361.sanmap'),
  ('~TEAM-8v8_Tropical_2048_73879', 'Maps/~TEAM-8v8_Tropical_2048_73879/~TEAM-8v8_Tropical_2048_73879.sanmap')
on conflict (name) do update set path = excluded.path;

update ladder_maps lm set path = sm.path
from shipped_maps sm
where lm.path is null and lower(lm.name) = lower(sm.name);

-- Map pools move into the database so the admin page can curate them
-- without a deploy. Seeded from src/lib/ladder-maps.ts (which stays as the
-- offline fallback). A disabled map stays listed for the admin but is
-- neither shown nor rolled.

create table ladder_maps (
  mode     text not null check (mode in ('1v1', '2v2', '3v3')),
  name     text not null,
  size     integer not null default 512,
  enabled  boolean not null default true,
  primary key (mode, name)
);

alter table ladder_maps enable row level security;

insert into ladder_maps (mode, name, size, enabled) values
  ('1v1', 'There Is Time', 512, true),
  ('1v1', '~TEAM-1v1_Tropical_256_47940', 256, true),
  ('1v1', '~TEAM-1v1_Tropical_256_92536', 256, true),
  ('1v1', '~TEAM-1v1_Desert_512_23678', 512, true),
  ('1v1', '~TEAM-1v1_Desert_512_89065', 512, true),
  ('1v1', '~TEAM-1v1_Forest_512_28589', 512, true),
  ('1v1', '~TEAM-1v1_Tropical_512_11446', 512, true),
  ('1v1', 'Two step shuffle', 1024, true),
  ('1v1', 'White Desert', 1024, true),
  ('1v1', '~TEAM-2v2_Frozen_256_25896', 256, true),
  ('1v1', '~TEAM-2v2_Desert_512_488', 512, true),
  ('1v1', '~TEAM-2v2_Forest_512_59807', 512, true),
  ('1v1', '~TEAM-2v2_Forest_512_83539', 512, true),
  ('1v1', '~TEAM-2v2_Frozen_512_23540', 512, true),
  ('1v1', '~TEAM-2v2_Tropical_512_40046', 512, true),
  ('1v1', '~FFA-4P_Desert_512_74685', 512, true),
  ('1v1', '~FFA-4P_Forest_512_59379', 512, true),
  ('1v1', '~FFA-4P_Frozen_512_59439', 512, true),
  ('1v1', '~FFA-4P_Tropical_512_51', 512, false), -- broken map, kept off
  ('1v1', '~FFA-4P_Forest_1024_45657', 1024, true),
  ('1v1', '~FFA-4P_Frozen_1024_3511', 1024, true),
  ('2v2', '~TEAM-2v2_Frozen_256_25896', 256, true),
  ('2v2', '~TEAM-2v2_Desert_512_488', 512, true),
  ('2v2', '~TEAM-2v2_Forest_512_59807', 512, true),
  ('2v2', '~TEAM-2v2_Forest_512_83539', 512, true),
  ('2v2', '~TEAM-2v2_Frozen_512_23540', 512, true),
  ('2v2', '~TEAM-2v2_Tropical_512_40046', 512, true),
  ('3v3', '~TEAM-3v3_Desert_512_67497', 512, true),
  ('3v3', '~TEAM-3v3_Forest_512_22736', 512, true),
  ('3v3', '~TEAM-3v3_Frozen_512_52755', 512, true),
  ('3v3', '~TEAM-3v3_Tropical_512_36001', 512, true),
  ('3v3', '~TEAM-3v3_Frozen_1024_42354', 1024, true),
  ('3v3', '~TEAM-3v3_Tropical_1024_24230', 1024, true);

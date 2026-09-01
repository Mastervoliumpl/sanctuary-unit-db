-- Optional custom names. When set, display_name is shown everywhere instead
-- of the Steam persona (every reader coalesces display_name → persona_name);
-- clearing it falls back to Steam. Case-insensitively unique so a chosen name
-- can't be claimed twice — Steam personas were never unique, but deliberate
-- names should be.

alter table players add column display_name text
  check (display_name is null or char_length(display_name) between 2 and 24);

create unique index players_display_name_unique
  on players (lower(display_name)) where display_name is not null;

// The ranked 1v1 map pool — the maps actually offered in the game's
// multiplayer lobby (names verbatim, including the generated ~TEAM/~FFA
// ones, so players can find them in the map list). Some support more than
// two spawns; that's fine, a 1v1 just uses two of them. The matchmaker picks
// one uniformly at random when it creates a match. Edit this list to curate
// the pool.

export interface LadderMap {
  name: string; // exactly as the game's lobby map list shows it
  size: number;
}

export const LADDER_MAPS_1V1: LadderMap[] = [
  { name: 'There Is Time', size: 512 },
  { name: '~TEAM-1v1_Tropical_256_47940', size: 256 },
  { name: '~TEAM-1v1_Tropical_256_92536', size: 256 },
  { name: '~TEAM-1v1_Desert_512_23678', size: 512 },
  { name: '~TEAM-1v1_Desert_512_89065', size: 512 },
  { name: '~TEAM-1v1_Forest_512_28589', size: 512 },
  { name: '~TEAM-1v1_Tropical_512_11446', size: 512 },
  { name: 'Two step shuffle', size: 1024 },
  { name: 'White Desert', size: 1024 },
  { name: '~TEAM-2v2_Frozen_256_25896', size: 256 },
  { name: '~TEAM-2v2_Desert_512_488', size: 512 },
  { name: '~TEAM-2v2_Forest_512_59807', size: 512 },
  { name: '~TEAM-2v2_Forest_512_83539', size: 512 },
  { name: '~TEAM-2v2_Frozen_512_23540', size: 512 },
  { name: '~TEAM-2v2_Tropical_512_40046', size: 512 },
  { name: '~FFA-4P_Desert_512_74685', size: 512 },
  { name: '~FFA-4P_Forest_512_59379', size: 512 },
  { name: '~FFA-4P_Frozen_512_59439', size: 512 },
  { name: '~FFA-4P_Tropical_512_51', size: 512 },
  { name: '~FFA-4P_Forest_1024_45657', size: 1024 },
  { name: '~FFA-4P_Frozen_1024_3511', size: 1024 },
];

export const ladderMapNames = (): string[] => LADDER_MAPS_1V1.map((m) => m.name);

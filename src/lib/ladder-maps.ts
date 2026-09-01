// The ranked 1v1 map pool: every official 2-spawn map the game ships with
// (read from the install's .sanmap files — they're in everyone's game, the
// site hosts nothing). The matchmaker picks one uniformly at random when it
// creates a match. Edit this list to curate the pool.

export interface LadderMap {
  name: string; // exactly as the game's lobby map list shows it
  size: number; // width == length for all of these
  hasWater: boolean;
}

export const LADDER_MAPS_1V1: LadderMap[] = [
  { name: 'Canis River', size: 256, hasWater: true },
  { name: 'Crag Dunes', size: 256, hasWater: false },
  { name: "Finn's Revenge", size: 512, hasWater: true },
  { name: 'There Is Time', size: 512, hasWater: false },
  { name: 'Theta Passage', size: 256, hasWater: false },
  { name: 'Varga Pass', size: 512, hasWater: false },
  { name: "Williamson's Bridge", size: 256, hasWater: false },
  { name: 'Winter Duel', size: 256, hasWater: false },
];

export const ladderMapNames = (): string[] => LADDER_MAPS_1V1.map((m) => m.name);

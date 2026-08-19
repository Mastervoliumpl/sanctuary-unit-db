// The contract for public/data/units.json — the one shape shared by the
// extractor's output and everything the site renders. If scripts/extract.js
// changes a field, change it here and let the compiler find the fallout.

export type Faction = 'EDA' | 'Chosen' | 'Guard' | 'Unknown';

export type UnitStatus = 'in-game' | 'in-progress' | 'no-model';

export interface UnitIconSpec {
  shape: string; // land1, bot2, structure1, ...
  symbol: string; // direct, indirect, aa, engineer, ...
  tech: string; // t1..t4
}

export interface ResourceRates {
  alloys?: number;
  energy?: number;
}

export interface AdjacencyEffect {
  category: string;
  resource: string;
  extra: number;
  targets: string[];
  label: string;
  percent: number;
}

export interface Adjacency {
  source: string;
  effects: AdjacencyEffect[];
}

export interface Shield {
  name: string;
  max: number;
  regen: number | null;
  regenDelay: number | null;
  rechargeTime: number | null;
  radius: number | null;
}

export interface Weapon {
  damage: number;
  damageType: string | null;
  damageRadius: number;
  reloadTime: number | null;
  salvoSize: number;
  salvoDelay: number;
  totalGroups: number;
  shotsPerCycle: number;
  rangeMax: number;
  rangeMin: number;
  isBeam: boolean;
  beamLifetime: number | null;
  beamMode: 'continuous' | 'pulse' | 'burst' | null;
  projectileSpeed: number | null;
  traverseSpeed: number | null;
  elevationSpeed: number | null;
  traverseArc: number | null;
  targets: string[];
  category: string | null;
  /** Per-instance DPS; null when the template gives the game nothing to score. */
  dps: number | null;
  /** Identical mounts collapsed into one entry carrying how many there are. */
  count: number;
  dpsTotal: number | null;
}

export interface Movement {
  type: string | null;
  speed: number;
  acceleration: number | null;
  rotationSpeed: number | null;
}

export interface Unit {
  id: string;
  declaredTpId: string | null;
  name: string | null;
  displayName: string;
  faction: Faction;
  domain: string; // Land, Air, Naval, Structure
  tier: number | null;
  role: string | null;
  icon: UnitIconSpec | null;
  hasModel: boolean;
  status: UnitStatus;
  statusReason: string | null;
  internalName: string | null;
  demoOnly: boolean;
  adjacency: Adjacency | null;
  cost: { alloys: number; energy: number };
  /** Build-power-seconds — wall-clock time is buildTime / builder.buildPower. */
  buildTime: number;
  production: ResourceRates | null;
  upkeep: ResourceRates | null;
  storage: ResourceRates | null;
  health: number;
  shields: Shield[];
  buildPower: number | null;
  /** Only units with a range can pour build power into someone else's build. */
  buildRange: number | null;
  orders: string[];
  canAssist: boolean;
  canBuildExpr: string | null;
  upgradesTo: string | null;
  builds: string[];
  builtBy: string[];
  movement: Movement | null;
  vision: number | null;
  radar: number | null;
  sonar: number | null;
  transportSlots: number | null;
  footprint: { x: number; y: number } | null;
  weapons: Weapon[];
  deathExplosion: { damage: number; radius: number | null } | null;
  dps: number | null;
  maxRange: number | null;
  projectileSpeed: number | null;
  tags: string[];
}

export interface UnitsMeta {
  generatedAt: string;
  source: string;
  unitCount: number;
  isDemo: boolean;
  dataIssues: string[];
}

export interface UnitsData {
  meta: UnitsMeta;
  units: Unit[];
}

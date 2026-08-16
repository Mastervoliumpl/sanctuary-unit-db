// Reads every unit template out of the game install and writes the flat JSON
// the site consumes. Re-run this after a game update: `npm run extract`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLuaTable } from './lua-parser.js';
import { locateGame, contentRoot } from './locate-game.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(here, '..', 'public', 'data', 'units.json');

// Third character of the template id encodes the domain, second the faction.
const FACTIONS = { e: 'EDA', c: 'Chosen', g: 'Guard', w: 'Guard' };
const DOMAINS = { l: 'Land', a: 'Air', n: 'Naval', s: 'Structure' };

// The faction tag a unit should carry, derived from its id. Used to catch
// mis-tagged templates — see normaliseFactionTag.
const FACTION_TAGS = { e: 'EDA', c: 'CHOSEN', g: 'GUARD', w: 'GUARD' };
const ALL_FACTION_TAGS = new Set(Object.values(FACTION_TAGS));

// Problems found in the game's own data, surfaced rather than silently patched.
const issues = [];

// Role is inferred from the icon symbol the game already assigns each unit,
// which is more reliable than guessing from tags or names.
const ROLES = {
  direct: 'Direct Fire',
  indirect: 'Artillery',
  aa: 'Anti-Air',
  antiNaval: 'Anti-Naval',
  engineer: 'Engineer',
  intel: 'Intel',
  shield: 'Shield',
  plasma: 'Plasma',
  alloy: 'Economy',
  air: 'Air',
  land: 'Land',
  naval: 'Naval',
  transmiter: 'Transmitter',
  none: null,
};

function main() {
  const gameDir = locateGame();
  const { root: lua, tree } = contentRoot(gameDir);
  console.log(`game:      ${gameDir}`);
  console.log(`tree:      ${tree}  (unit data; art always comes from prototype)`);

  const available = readAvailability(path.join(lua, 'common', 'units', 'availableUnits.lua'));
  const models = scanUnitModels(gameDir);
  console.log(`models:    ${models.size} unit ids have LOD art in the scene files`);
  const templateDir = path.join(lua, 'common', 'units', 'unitsTemplates');

  const units = [];
  const failures = [];

  for (const id of fs.readdirSync(templateDir).sort()) {
    const file = path.join(templateDir, id, `${id}.santp`);
    if (!fs.existsSync(file)) {
      failures.push({ id, reason: 'no .santp file in template folder' });
      continue;
    }
    try {
      const raw = parseLuaTable(fs.readFileSync(file, 'utf8'), { assignment: 'UnitTemplate' });
      units.push(toUnit(raw, id, available, models));
    } catch (err) {
      failures.push({ id, reason: err.message });
    }
  }

  // Two units sharing an id would silently lose build-tree edges to whichever
  // one a Map lookup happened to keep, so treat it as fatal rather than subtle.
  const counts = new Map();
  for (const u of units) counts.set(u.id, (counts.get(u.id) ?? 0) + 1);
  const collisions = [...counts].filter(([, n]) => n > 1);
  if (collisions.length) {
    throw new Error(`duplicate unit ids: ${collisions.map(([id, n]) => `${id} ×${n}`).join(', ')}`);
  }

  resolveBuildTrees(units);

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: path.basename(gameDir),
      unitCount: units.length,
      // Surfaced in the UI so nobody mistakes demo balance for release balance.
      isDemo: /demo/i.test(path.basename(gameDir)),
      // Faults in the game's own templates that this run worked around.
      dataIssues: issues,
    },
    units: units.sort((a, b) => a.id.localeCompare(b.id)),
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));

  report(units, failures, payload);
}

// Which units actually have a model, found by looking for their LOD assets in
// the scene files. A unit's mesh, material and textures are all named
// <tpId>_lod<n>, so the id appearing in that form means the art exists.
//
// This replaces availableUnits.lua as the availability signal. That file is
// hand-maintained ("Validated by eyes!"), disabled in the loader
// (useAvailableUnitsList = false), and wrong about 90 units — it claims
// "no model" for things like the Chosen T1 Raider that are plainly modelled.
function scanUnitModels(gameDir) {
  const pattern = /u[ecgw][lans]\d{4}(?=_lod\d)/g;
  const found = new Set();

  // Only the prototype build ships unit art — the engine build's asset files
  // contain no unit LODs and no strategic icons at all — but scan every build's
  // data directory so this keeps working if that changes.
  const dataDirs = fs
    .readdirSync(gameDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      const buildDir = path.join(gameDir, e.name);
      return fs
        .readdirSync(buildDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /_Data$/.test(d.name))
        .map((d) => path.join(buildDir, d.name));
    });

  for (const dir of dataDirs) {
    // Scenes share assets, so read them all in case a unit appears in only one.
    // Each is read and released in turn — they run to ~100 MB apiece.
    for (const file of fs.readdirSync(dir).filter((f) => /^level\d+$/.test(f))) {
      let text;
      try {
        text = fs.readFileSync(path.join(dir, file)).toString('latin1');
      } catch {
        continue;
      }
      for (const match of text.matchAll(pattern)) found.add(match[0]);
    }
  }
  return found;
}

// The engine tree's availableUnits.lua is a live QA tracker, not the stale list
// the prototype tree carries. Each row is
//
//   ucl4001 = true,  -- ChosenT4Bot   -- OK
//   uca4011 = false, -- ChosenT4Gunship -- OK_PENDING_APPROVAL
//
// and the reason codes line up with the shipped art almost exactly: every
// OK/OK_PENDING_APPROVAL/BONE_MISSMATCH unit has a model, and NO_MODEL units
// overwhelmingly don't. So the flag means "signed off and enabled", not
// "exists" — the two together give a three-way status.
function readAvailability(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  const text = fs.readFileSync(file, 'utf8');

  for (const m of text.matchAll(/^\s*([a-z]{3}\d{4})\s*=\s*(true|false)\s*,?\s*(?:--\s*(.*))?$/gm)) {
    const comment = (m[3] ?? '').replace(/\s+/g, ' ').trim();
    // The comment carries the internal name, then the reason code.
    const [internalName, reason] = comment.split(/\s+--\s+/);
    map.set(m[1], {
      enabled: m[2] === 'true',
      internalName: internalName?.trim() || null,
      reason: reason?.trim() || null,
    });
  }
  return map;
}

// Reason codes, prettified for display.
const REASONS = {
  OK: 'Signed off',
  OK_PENDING_APPROVAL: 'Pending approval',
  BONE_MISSMATCH: 'Rigging mismatch',
  BATTLE_NO_DAMAGE: 'No damage state',
  NO_MODEL: 'No model',
};

// Three buckets, from the empirical art scan crossed with the QA flag:
//   in-game      art exists and it is signed off and enabled
//   in-progress  art exists but it is gated (approval, rigging, damage state)
//   no-model     nothing to render
function statusOf(hasModel, entry) {
  if (!hasModel) return 'no-model';
  return entry?.enabled ? 'in-game' : 'in-progress';
}

function toUnit(t, id, available, models) {
  const general = t.general ?? {};
  const economy = t.economy ?? {};
  const status = available.get(id);

  // Identity is the filename, not general.tpId. templateLoader's
  // ReadUnitTemplate(tp, tpId) takes tpId from the caller and gates on
  // AvailableUnits[tpId], which is keyed by filename — so that's what the game
  // uses. One template (ugs2807) carries a stale copied tpId of "ugs2806";
  // trusting the field would collide two units onto one id.
  if (general.tpId && general.tpId !== id) {
    issues.push(`${id} declares tpId "${general.tpId}" — using the filename instead`);
  }

  const tags = normaliseFactionTag(t.tags ?? [], id);

  // Death explosions are listed alongside weapons but only fire when the unit
  // dies, so they're reported separately and kept out of DPS and range.
  const allWeapons = (t.weapons ?? []).map(toWeapon).filter((w) => w.damage > 0 || w.rangeMax > 0);
  const weapons = groupWeapons(allWeapons.filter((w) => w.category !== 'DeathExplosion'));
  const deathExplosion = allWeapons.find((w) => w.category === 'DeathExplosion') ?? null;

  const cost = {
    alloys: economy.cost?.alloys ?? 0,
    energy: economy.cost?.energy ?? 0,
  };

  return {
    id,
    declaredTpId: general.tpId && general.tpId !== id ? general.tpId : null,
    name: general.name || null,
    displayName: general.displayName ?? '',
    faction: FACTIONS[id[1]] ?? 'Unknown',
    domain: DOMAINS[id[2]] ?? 'Unknown',
    tier: tierOf(tags),
    role: ROLES[general.icon?.symbol] ?? null,
    icon: {
      shape: general.icon?.shape ?? null,
      symbol: general.icon?.symbol ?? null,
      tech: general.icon?.tech ?? null,
    },

    // Does the unit have art that would actually render, found by scanning the
    // scene files for its LOD assets rather than trusting any list.
    hasModel: models.has(id),
    // in-game | in-progress | no-model
    status: statusOf(models.has(id), status),
    // Why it isn't enabled, straight from the QA tracker's reason code.
    statusReason: REASONS[status?.reason] ?? status?.reason ?? null,
    internalName: status?.internalName ?? null,
    demoOnly: tags.includes('DEMO_UI_ONLY'),

    cost,
    buildTime: economy.buildTime ?? 0,
    production: nonEmpty(economy.production),
    upkeep: nonEmpty(economy.maintenanceConsumption),
    storage: nonEmpty(economy.storage),

    health: t.defence?.health?.max ?? 0,
    shields: (t.defence?.shields ?? []).map((s) => ({
      name: s.name ?? 'Shield',
      max: s.max ?? 0,
      regen: s.regen ?? null,
      regenDelay: s.regenDelay ?? null,
      rechargeTime: s.rechargeTime ?? null,
      // radii is an x/y/z extent; the shield bubble is spherical so x is the radius.
      radius: s.radii?.x ?? null,
    })),

    buildPower: t.construction?.buildPower ?? null,
    canBuildExpr: t.construction?.canBuild ?? null,
    upgradesTo: t.construction?.upgradesTo ?? null,
    // Filled in by resolveBuildTrees once every unit is known.
    builds: [],
    builtBy: [],

    movement: t.movement
      ? {
          type: t.movement.type ?? null,
          speed: t.movement.speed ?? null,
          acceleration: t.movement.acceleration ?? null,
          rotationSpeed: t.movement.rotationSpeed ?? null,
        }
      : null,

    vision: t.intel?.visionRadius ?? null,
    radar: t.intel?.radarRadius ?? null,
    sonar: t.intel?.sonarRadius ?? null,

    transportSlots: t.transport?.storage ?? null,
    footprint: t.footprint ? { x: t.footprint.x, y: t.footprint.y } : null,

    weapons,
    deathExplosion: deathExplosion
      ? { damage: deathExplosion.damage, radius: deathExplosion.damageRadius }
      : null,
    dps: round(weapons.reduce((sum, w) => sum + w.dpsTotal, 0)),
    maxRange: weapons.length ? Math.max(...weapons.map((w) => w.rangeMax)) : 0,
    // The main weapon's travel speed. Ranked among weapons that actually fire a
    // projectile, so a unit whose top gun is a beam still reports its cannon
    // rather than nothing — the per-weapon table shows the full picture.
    projectileSpeed: mainWeapon(weapons.filter((w) => w.projectileSpeed != null))?.projectileSpeed ?? null,

    tags,
  };
}

// Firing model, per the game's own template documentation:
//   muzzleGroups    - each group is a set of muzzle bones that fire together
//   muzzleSalvoSize - how many *groups* fire in one cycle (not shots per muzzle)
//   reloadTime      - seconds between cycles
// So a weapon with ten groups and a salvo size of one fires a single group per
// cycle and cycles through them; counting all ten would overstate it tenfold.
// Projectile speed lives on the weapon's aim controllers, not on the projectile
// template (those are visuals only). A weapon can have several controllers: one
// driving the turret yaw, which carries a coarse lead-estimate speed, and one
// per muzzle carrying the real firing solution. Prefer the muzzle-bound ones.
//
//   ucl4002: yaw controller says 30, both muzzle controllers say 6 -> 6
function projectileSpeedOf(w) {
  const controllers = w.aimControllers ?? [];
  const muzzleBound = controllers.filter((a) => /muzzle/i.test(a.aimBone ?? ''));
  // The T1 Bomber declares 0.0001, which means "drops under gravity" rather than
  // any real muzzle velocity. Every genuine speed in the data is >= 5, so the
  // cutoff is unambiguous and reporting the placeholder would be nonsense.
  const speeds = (muzzleBound.length ? muzzleBound : controllers)
    .map((a) => a.projectileSpeed)
    .filter((v) => typeof v === 'number' && v >= 1);

  if (!speeds.length) return null;

  // Take the most common value; ties break low so we never overstate it.
  const counts = new Map();
  for (const v of speeds) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

// How fast the weapon tracks a target, and how far around it can point.
//
// Controllers are split by axis: the one bound to a yawBone traverses, the ones
// bound to a pitchBone elevate. A weapon can have several of each, so take the
// most common speed per axis the same way projectile speed does.
//
// Note this reads the `weapons` block, not `turrets`. templateExplainations.lua
// marks `turrets` as "Old format, still have some leftover stuff", and its
// turnRateDegreesPerSecond disagrees with the live value on 20 weapons.
function aimingOf(w) {
  const controllers = w.aimControllers ?? [];

  const mode = (values) => {
    const nums = values.filter((v) => typeof v === 'number' && v > 0);
    if (!nums.length) return null;
    const counts = new Map();
    for (const v of nums) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  };

  const yawControllers = controllers.filter((c) => c.yawBone);
  const pitchControllers = controllers.filter((c) => c.pitchBone);

  // Arc comes from whichever yaw controller declares limits; 360 means the
  // turret spins freely, anything less is a restricted firing arc.
  const arcSource = yawControllers.find((c) => c.yawMin != null && c.yawMax != null);

  return {
    traverseSpeed: mode(yawControllers.map((c) => c.yawSpeed)),
    elevationSpeed: mode(pitchControllers.map((c) => c.pitchSpeed)),
    traverseArc: arcSource ? Math.round(arcSource.yawMax - arcSource.yawMin) : null,
  };
}

function toWeapon(w) {
  const damage = w.damage ?? 0;
  const reload = w.reloadTime ?? 0;
  const groups = w.muzzleGroups ?? [];
  const salvoGroups = Math.min(w.muzzleSalvoSize ?? 1, groups.length || 1);
  const isBeam = w.beamLifetime != null;

  const fired = groups.slice(0, salvoGroups);
  const shotsPerCycle = fired.length
    ? fired.reduce((n, g) => n + (g.muzzles?.length ?? 1), 0)
    : salvoGroups;

  return {
    damage,
    damageType: w.damageType ?? 'Normal',
    damageRadius: w.damageRadius ?? 0,
    reloadTime: reload,
    salvoGroups,
    totalGroups: groups.length,
    shotsPerCycle,
    rangeMax: w.rangeMax ?? 0,
    rangeMin: w.rangeMin ?? 0,
    isBeam,
    // Beams apply damage along their length rather than launching anything, so
    // the speed on their controllers is a lead-calculation artefact, not travel
    // time. Reporting it would imply a flight time that doesn't exist.
    projectileSpeed: isBeam ? null : projectileSpeedOf(w),
    // Tracking speed applies to beams too — they still have to swing onto target.
    ...aimingOf(w),
    targets: w.layerTargetLimits ?? [],
    category: w.category ?? null,
    dps: reload > 0 ? round((damage * shotsPerCycle) / reload) : 0,
  };
}

// canBuild is a boolean tag expression. `*` is AND, `+` is OR, and parentheses
// group:
//
//   Tags.EDA * Tags.BUILDABLE_BY_T1_FACTORY * ((Tags.LAND * Tags.MOBILE) + Tags.LAND_FACTORY)
//
// i.e. a land factory builds EDA land units, or another land factory — that's
// the upgrade chain. An atom that names a template id rather than a tag matches
// that one unit, which is how in-place structure upgrades are written
// ("Tags.ugs2806"). 27 of the 69 expressions use the OR/parenthesis form; a
// naive split on `*` silently drops them, costing ~90 units their builders.
function compileTagExpression(src) {
  const tokens = src.match(/Tags\.[A-Za-z0-9_]+|[*+()]/g) ?? [];
  let pos = 0;

  // orExpr := andExpr ('+' andExpr)*
  const orExpr = () => {
    let node = andExpr();
    while (tokens[pos] === '+') {
      pos++;
      const [lhs, rhs] = [node, andExpr()];
      node = (u) => lhs(u) || rhs(u);
    }
    return node;
  };

  // andExpr := atom ('*' atom)*
  const andExpr = () => {
    let node = atom();
    while (tokens[pos] === '*') {
      pos++;
      const [lhs, rhs] = [node, atom()];
      node = (u) => lhs(u) && rhs(u);
    }
    return node;
  };

  const atom = () => {
    if (tokens[pos] === '(') {
      pos++;
      const node = orExpr();
      if (tokens[pos] !== ')') throw new Error(`expected ")" in: ${src}`);
      pos++;
      return node;
    }
    const token = tokens[pos++];
    if (!token?.startsWith('Tags.')) throw new Error(`unexpected "${token ?? 'end'}" in: ${src}`);
    const name = token.slice(5);
    return (u) => u.tags.includes(name) || u.id === name;
  };

  const matches = orExpr();
  if (pos !== tokens.length) throw new Error(`trailing tokens in: ${src}`);
  return matches;
}

function resolveBuildTrees(units) {
  const byId = new Map(units.map((u) => [u.id, u]));

  for (const builder of units) {
    const targets = new Set();

    if (builder.canBuildExpr) {
      try {
        const matches = compileTagExpression(builder.canBuildExpr);
        for (const candidate of units) if (matches(candidate)) targets.add(candidate.id);
      } catch (err) {
        // Never fail silently here — an unparsed expression means a builder
        // quietly loses its whole build list.
        issues.push(`${builder.id} has an unparseable canBuild (${err.message})`);
      }
    }

    // Structure upgrades are a build action too, so they belong in the tree.
    if (builder.upgradesTo && byId.has(builder.upgradesTo)) targets.add(builder.upgradesTo);

    targets.delete(builder.id);
    builder.builds = [...targets].sort();
  }

  for (const builder of units) {
    for (const targetId of builder.builds) byId.get(targetId).builtBy.push(builder.id);
  }
  for (const unit of units) unit.builtBy.sort();
}

// Big units mount the same gun several times — the Phoenix carries nine weapons
// that are really three designs, the T5 Hovertank eleven that are four. Listing
// each copy is noise, so identical entries collapse into one with a count.
function groupWeapons(weapons) {
  const groups = new Map();

  for (const w of weapons) {
    const key = JSON.stringify([
      w.damage, w.damageType, w.damageRadius, w.reloadTime, w.rangeMax, w.rangeMin,
      w.isBeam, w.projectileSpeed, w.shotsPerCycle, w.category, w.targets,
      w.traverseSpeed, w.elevationSpeed, w.traverseArc,
    ]);
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { ...w, count: 1 });
  }

  return [...groups.values()]
    .map((w) => ({ ...w, dpsTotal: round(w.dps * w.count) }))
    .sort((a, b) => b.dpsTotal - a.dpsTotal || b.rangeMax - a.rangeMax);
}

// Highest DPS wins; ties go to the longer-ranged weapon, then the harder hitter.
function mainWeapon(weapons) {
  return weapons
    .slice()
    .sort((a, b) => b.dpsTotal - a.dpsTotal || b.rangeMax - a.rangeMax || b.damage - a.damage)[0];
}

// Build lists are resolved by matching tag expressions, so a wrong faction tag
// puts a unit in the wrong faction's factory. Two templates get this wrong:
//
//   ugl2806 "Relay"          tagged CHOSEN — its tag list is byte-identical to
//                            the Chosen sibling ucl2806, so the Guard variant
//                            was copied without changing the faction. It shows
//                            up under Chosen factories and is missing from Guard's.
//   ues1111 "Freeze Station" has no faction tag at all, so no builder expression
//                            can match it and nothing can build it.
//
// The id prefix is unambiguous in both cases, so correct from that and record
// it. When the templates are fixed upstream these stop firing and nothing about
// the output changes.
function normaliseFactionTag(tags, id) {
  const expected = FACTION_TAGS[id[1]];
  if (!expected) return tags;

  const present = tags.filter((t) => ALL_FACTION_TAGS.has(t));
  if (present.length === 1 && present[0] === expected) return tags;

  if (present.length === 0) {
    issues.push(`${id} has no faction tag — adding ${expected} from its id`);
  } else {
    issues.push(`${id} is tagged ${present.join('+')} but its id says ${expected} — corrected`);
  }

  return [...tags.filter((t) => !ALL_FACTION_TAGS.has(t)), expected].sort();
}

function tierOf(tags) {
  const tag = tags.find((t) => /^TECH\d$/.test(t));
  return tag ? Number(tag.slice(4)) : null;
}

function nonEmpty(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const entries = Object.entries(obj).filter(([, v]) => typeof v === 'number' && v !== 0);
  return entries.length ? Object.fromEntries(entries) : null;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function report(units, failures, payload) {
  const size = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
  console.log(`parsed:    ${units.length} units (${failures.length} failed)`);
  for (const f of failures) console.warn(`  ! ${f.id}: ${f.reason}`);

  const tally = (key) =>
    Object.entries(
      units.reduce((acc, u) => ((acc[u[key]] = (acc[u[key]] ?? 0) + 1), acc), {})
    )
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');

  console.log(`faction:   ${tally('faction')}`);
  console.log(`domain:    ${tally('domain')}`);
  const byStatus = (s) => units.filter((u) => u.status === s).length;
  console.log(
    `status:    ${byStatus('in-game')} in game, ` +
      `${byStatus('in-progress')} modelled but gated, ` +
      `${byStatus('no-model')} no model`
  );
  console.log(`build tree: ${units.filter((u) => u.builds.length).length} builders, ` +
    `${units.filter((u) => u.builtBy.length).length} units reachable`);
  console.log(`wrote:     ${path.relative(process.cwd(), OUT_FILE)} (${size} KB)`);
  if (payload.meta.isDemo) console.log('note:      demo build — balance values are not final');

  if (issues.length) {
    console.log(`\ngame data faults worked around (${issues.length}):`);
    for (const issue of issues) console.log(`  · ${issue}`);
  }
}

// This is the one script that needs a local game install, so when it can't find
// one, say so plainly instead of dumping a stack trace at whoever ran it.
try {
  main();
} catch (err) {
  console.error(`\nExtraction failed: ${err.message}\n`);
  console.error('This script reads the installed game and only runs locally —');
  console.error('production serves the committed public/ directory as-is.');
  console.error('To check the committed data instead, run: npm run verify\n');
  process.exit(1);
}

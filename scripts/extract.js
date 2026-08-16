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
  const lua = contentRoot(gameDir);
  console.log(`game:      ${gameDir}`);

  const available = readAvailability(path.join(lua, 'common', 'units', 'availableUnits.lua'));
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
      units.push(toUnit(raw, id, available));
    } catch (err) {
      failures.push({ id, reason: err.message });
    }
  }

  resolveBuildTrees(units);

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: path.basename(gameDir),
      unitCount: units.length,
      // Surfaced in the UI so nobody mistakes demo balance for release balance.
      isDemo: /demo/i.test(path.basename(gameDir)),
    },
    units: units.sort((a, b) => a.id.localeCompare(b.id)),
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));

  report(units, failures, payload);
}

// availableUnits.lua marks which templates are actually playable. Units missing
// from it are treated as restricted by the game, so we mirror that default.
function readAvailability(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/^\s*([a-z]{3}\d{4})\s*=\s*(true|false)\s*,?\s*(?:--\s*(.*))?$/gm)) {
    const note = (m[3] ?? '').replace(/\s+/g, ' ').trim();
    map.set(m[1], {
      playable: m[2] === 'true',
      // The trailing comment carries the internal name then a status note.
      note: note.split(/\s{2,}|\s--\s/).pop() || null,
    });
  }
  return map;
}

function toUnit(t, id, available) {
  const general = t.general ?? {};
  const economy = t.economy ?? {};
  const tags = t.tags ?? [];
  const status = available.get(id);

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
    id: general.tpId ?? id,
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

    playable: status?.playable ?? false,
    statusNote: status?.note ?? null,
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

// canBuild is a tag expression: "Tags.EDA * Tags.BUILDABLE_BY_T1_FACTORY * Tags.LAND",
// where `*` means AND. A token that matches a template id instead names one
// specific unit — that's how in-place structure upgrades are expressed.
function resolveBuildTrees(units) {
  const byId = new Map(units.map((u) => [u.id, u]));

  for (const builder of units) {
    const targets = new Set();

    if (builder.canBuildExpr) {
      const tokens = builder.canBuildExpr
        .split('*')
        .map((s) => s.trim().replace(/^Tags\./, ''))
        .filter(Boolean);

      const direct = tokens.filter((tok) => byId.has(tok));
      const required = tokens.filter((tok) => !byId.has(tok));

      for (const tok of direct) targets.add(tok);

      if (required.length) {
        for (const candidate of units) {
          if (required.every((tag) => candidate.tags.includes(tag))) targets.add(candidate.id);
        }
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
  console.log(`playable:  ${units.filter((u) => u.playable).length} of ${units.length}`);
  console.log(`build tree: ${units.filter((u) => u.builds.length).length} builders, ` +
    `${units.filter((u) => u.builtBy.length).length} units reachable`);
  console.log(`wrote:     ${path.relative(process.cwd(), OUT_FILE)} (${size} KB)`);
  if (payload.meta.isDemo) console.log('note:      demo build — balance values are not final');
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

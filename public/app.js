import { unitIcon, loadIconManifest, FACTION_COLOURS, FACTION_ORDER } from '/icons.js';
import { mountHeader, loadUnits, setMetaLine } from '/shared/nav.js';

const $ = (sel) => document.querySelector(sel);

// Availability comes from the engine tree's QA tracker crossed with whether the
// unit actually has art. "In progress" means the model exists but is gated —
// awaiting approval, bad rigging, or missing a damage state.
const STATUS_LABELS = {
  'in-game': 'In game',
  'in-progress': 'In progress',
  'no-model': 'No model',
};
const DEFAULT_STATUS = 'In game';

const state = {
  units: [],
  byId: new Map(),
  groups: [],
  previews: new Set(),
  search: '',
  filters: { faction: new Set(), domain: new Set(), tier: new Set(), role: new Set(), status: new Set([DEFAULT_STATUS]) },
  sort: 'default',
  selected: null,
};

const DOMAIN_ORDER = { l: 0, a: 1, n: 2, s: 3 };
const DOMAIN_NAMES = { l: 'Land', a: 'Air', n: 'Naval', s: 'Structure' };

const METRICS = {
  alloys: (u) => u.cost.alloys,
  energy: (u) => u.cost.energy,
  buildTime: (u) => u.buildTime,
  health: (u) => u.health,
  dps: (u) => u.dps,
  projectileSpeed: (u) => u.projectileSpeed ?? 0,
  turnRate: (u) => u.movement?.rotationSpeed ?? 0,
  traverseSpeed: (u) => Math.max(0, ...u.weapons.map((w) => w.traverseSpeed ?? 0)),
};

init();

async function init() {
  // Icons are needed before the first paint, otherwise they render as SVG and
  // then swap to artwork a frame later. Previews only matter once a unit is
  // opened, so a failure there is non-fatal.
  mountHeader({ subtitle: 'Loading…' });

  const [data, , previews] = await Promise.all([
    loadUnits(),
    loadIconManifest(),
    fetch('/previews/manifest.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);
  state.previews = new Set(previews);
  state.units = data.units;
  state.byId = new Map(data.units.map((u) => [u.id, u]));
  state.groups = buildGroups(data.units);

  setMetaLine(
    `${data.meta.unitCount} units · ` +
    `${data.units.filter((u) => u.status === 'in-game').length} in game, ` +
    `${data.units.filter((u) => u.status === 'in-progress').length} in progress · ` +
    `extracted ${new Date(data.meta.generatedAt).toLocaleDateString()}`);

  buildFilters();
  wireEvents();
  readUrl();
  render();
}

/* ---------------- filters ---------------- */

function buildFilters() {
  const distinct = (fn) => [...new Set(state.units.map(fn).filter((v) => v != null))];

  const groups = [
    { key: 'faction', title: 'Faction', values: distinct((u) => u.faction), colour: true },
    { key: 'domain', title: 'Domain', values: distinct((u) => u.domain) },
    { key: 'tier', title: 'Tier', values: distinct((u) => u.tier).sort((a, b) => a - b), label: (v) => `T${v}` },
    { key: 'role', title: 'Role', values: distinct((u) => u.role).sort() },
    { key: 'status', title: 'Availability', values: Object.values(STATUS_LABELS) },
  ];

  $('#filter-groups').innerHTML = groups
    .map(
      (g) => `<div class="fgroup"><h3>${g.title}</h3><div class="chips">${g.values
        .map((v) => {
          const dot = g.colour
            ? `<span class="dot" style="background:${FACTION_COLOURS[v] ?? '#888'}"></span>`
            : '';
          return `<button type="button" class="chip" data-group="${g.key}" data-value="${v}"
                    aria-pressed="false">${dot}${g.label ? g.label(v) : v}</button>`;
        })
        .join('')}</div></div>`
    )
    .join('');
}

function matches(unit) {
  const f = state.filters;
  if (f.faction.size && !f.faction.has(unit.faction)) return false;
  if (f.domain.size && !f.domain.has(unit.domain)) return false;
  if (f.tier.size && !f.tier.has(String(unit.tier))) return false;
  if (f.role.size && !f.role.has(unit.role)) return false;
  if (f.status.size && !f.status.has(STATUS_LABELS[unit.status])) return false;

  if (state.search) {
    const q = state.search.toLowerCase();
    const haystack = [unit.id, unit.name, unit.displayName, unit.role, unit.faction, unit.domain, ...unit.tags]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

/* ---------------- cross-faction grouping ---------------- */

// Template ids are u<faction><domain><code>, so uel1001 / ucl1001 / ugl1001 are
// the same slot in each faction's roster. Dropping the faction letter gives a
// key that lines equivalent units up across columns — Puma / Gladius / Gimlet.
//
// The id numbering is *nearly* tier-aligned, but not reliably: uel3002 "Hyena"
// is TECH2 (internally EDAT2FastUnit2 — EDA's second T2 raider) despite the 3,
// and uga3011 "TALEN" is TECH1. Grouping on the id alone therefore stranded
// Hyena in the T3 row, away from the other T2 raiders.
//
// So: bucket by id slot, split any slot spanning several tiers, then merge
// buckets that agree on domain, tier and label. Grouping purely by label
// instead would fix the raiders but shatter the slots where factions diverge in
// purpose — the 2806 row (repair station / shield booster / transmitter) would
// become nine single-faction rows instead of three aligned ones.
function buildGroups(units) {
  const slots = new Map();
  for (const unit of units) {
    const key = unit.id[2] + unit.id.slice(3);
    (slots.get(key) ?? slots.set(key, []).get(key)).push(unit);
  }

  // Split slots whose members disagree on tier — they aren't equivalents.
  const parts = [];
  for (const members of slots.values()) {
    const tiers = [...new Set(members.map((u) => u.tier))];
    if (tiers.length <= 1) parts.push(members);
    else for (const tier of tiers) parts.push(members.filter((u) => u.tier === tier));
  }

  const groups = new Map();
  for (const members of parts) {
    const first = members[0];
    const label = commonLabel(members);
    const key = `${first.id[2]}|${first.tier}|${label.toLowerCase()}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        domain: first.id[2],
        tier: first.tier ?? 0,
        label,
        role: members.find((u) => u.role)?.role ?? null,
        units: [],
        byFaction: {},
      });
    }
    const group = groups.get(key);
    for (const unit of members) {
      group.units.push(unit);
      (group.byFaction[unit.faction] ??= []).push(unit);
    }
  }

  // Order rows by the lowest id code they contain, so merged rows land where
  // the earlier of their slots used to sit.
  for (const group of groups.values()) {
    group.code = group.units.map((u) => u.id.slice(3)).sort()[0];
    group.role ??= group.units.find((u) => u.role)?.role ?? null;
  }

  return [...groups.values()].sort(byTechTree);
}

// Factions occasionally diverge within a slot (one gets a repair station where
// another gets a shield booster). Use the most common label and let the cards
// show the differences rather than hiding them.
function commonLabel(units) {
  const counts = new Map();
  for (const u of units) {
    const label = u.displayName.replace(/^Tier \d+:\s*/, '').trim();
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (!counts.size) return units[0]?.id ?? '';
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

const byTechTree = (a, b) =>
  DOMAIN_ORDER[a.domain] - DOMAIN_ORDER[b.domain] ||
  a.tier - b.tier ||
  a.code.localeCompare(b.code);

function visibleGroups() {
  const groups = state.groups
    .map((group) => {
      const kept = group.units.filter(matches);
      return kept.length ? { ...group, units: kept, byFaction: groupByFaction(kept) } : null;
    })
    .filter(Boolean);

  if (state.sort === 'default') return groups;

  // Sorting keeps rows intact so the alignment survives — a row is ranked by its
  // strongest member, which is what you want when hunting for the costliest slot.
  const metric = METRICS[state.sort];
  const scoreOf = (g) => Math.max(...g.units.map((u) => metric(u) ?? 0));
  return groups.sort((a, b) => scoreOf(b) - scoreOf(a) || byTechTree(a, b));
}

function groupByFaction(units) {
  const out = {};
  for (const u of units) (out[u.faction] ??= []).push(u);
  return out;
}

// Columns follow the faction filter when one is active, so filtering to EDA
// collapses the layout to a single column instead of leaving two empty ones.
function activeFactions() {
  const chosen = state.filters.faction;
  return FACTION_ORDER.filter((f) => !chosen.size || chosen.has(f));
}

/* ---------------- rendering ---------------- */

function render() {
  const groups = visibleGroups();
  const factions = activeFactions();
  const shown = groups.reduce((n, g) => n + g.units.length, 0);

  $('#count').textContent = `${shown} of ${state.units.length} units · ${groups.length} slots`;
  $('#results').innerHTML = groups.length === 0
    ? `<p class="empty">No units match those filters.</p>`
    : boardHtml(groups, factions);
  writeUrl();
}

function boardHtml(groups, factions) {
  const head = factions
    .map(
      (f) => `<div class="col-head" style="--fc:${FACTION_COLOURS[f]}">${f}</div>`
    )
    .join('');

  let lastDomain = null;
  const rows = groups
    .map((group) => {
      // Only meaningful while in tech-tree order; a metric sort mixes domains.
      let heading = '';
      if (state.sort === 'default' && group.domain !== lastDomain) {
        lastDomain = group.domain;
        heading = `<h2 class="domain-head">${DOMAIN_NAMES[group.domain] ?? group.domain}</h2>`;
      }

      const cells = factions
        .map((f) => {
          const units = group.byFaction[f] ?? [];
          return units.length
            ? `<div class="cell">${units.map(cardHtml).join('')}</div>`
            : `<div class="cell empty-cell" aria-hidden="true"></div>`;
        })
        .join('');

      return `${heading}
        <div class="slot">
          <div class="slot-label">
            ${group.tier ? `<span class="tier-pill">T${group.tier}</span>` : ''}
            <span>${group.label}</span>
          </div>
          <div class="slot-row" style="--cols:${factions.length}">${cells}</div>
        </div>`;
    })
    .join('');

  return `<div class="board">
    <div class="col-heads" style="--cols:${factions.length}">${head}</div>
    ${rows}
  </div>`;
}

function cardHtml(u) {
  // Only no-model units get dimmed — an in-progress unit has real art and real
  // numbers, it just isn't switched on, so it keeps its colour and says why.
  return `<button type="button" class="card ${u.status === 'no-model' ? 'unplayable' : ''}"
      data-id="${u.id}" style="--fc:${FACTION_COLOURS[u.faction]}">
    ${unitIcon(u.icon, u.faction, { size: 38, muted: u.status === 'no-model' })}
    <span class="who">
      <h4>${u.name ?? shortName(u)}${
        u.status === 'in-progress'
          ? `<span class="wip" title="${u.statusReason ?? 'Not enabled'}">WIP</span>`
          : ''
      }</h4>
      <small>${u.displayName}</small>
      <span class="stat-row">
        <span class="alloy-val">${fmt(u.cost.alloys)}<i>a</i></span>
        <span class="energy-val">${fmt(u.cost.energy)}<i>e</i></span>
        <span class="dim">${fmt(u.health)}<i>hp</i></span>
        ${u.dps ? `<span class="dim">${fmt(u.dps)}<i>dps</i></span>` : ''}
      </span>
      ${weaponLines(u)}
    </span>
  </button>`;
}

// One line per distinct weapon. Grouping means even the heaviest units top out
// at four, so every weapon fits without the card running away.
function weaponLines(u) {
  if (!u.weapons.length) return '';

  const lines = u.weapons.map((w) => {
    const bits = [
      w.damage > 0 ? `${fmt(w.damage)} dmg` : 'impact',
      `${w.rangeMax} rng`,
      w.isBeam ? beamLabel(w).replace(' beam', '') : w.projectileSpeed ? `${fmt(w.projectileSpeed)} spd` : null,
    ].filter(Boolean);

    return `<span class="wline">
      ${w.count > 1 ? `<b>×${w.count}</b>` : ''}${bits.join(' · ')}
    </span>`;
  });

  return `<span class="wlines">${lines.join('')}</span>`;
}

/* ---------------- detail panel ---------------- */

function openDetail(id) {
  const u = state.byId.get(id);
  if (!u) return;
  state.selected = id;

  $('#detail').innerHTML = detailHtml(u);
  $('#detail').hidden = false;
  $('#scrim').hidden = false;
  $('#detail').scrollTop = 0;
  writeUrl();
}

function closeDetail() {
  state.selected = null;
  $('#detail').hidden = true;
  $('#scrim').hidden = true;
  writeUrl();
}

function detailHtml(u) {
  const stat = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;

  const core = [
    stat('Alloys', `<span class="alloy-val">${fmt(u.cost.alloys)}</span>`),
    stat('Energy', `<span class="energy-val">${fmt(u.cost.energy)}</span>`),
    stat('Build time', fmt(u.buildTime)),
    stat('Health', fmt(u.health)),
    u.dps ? stat('DPS', fmt(u.dps)) : '',
    u.maxRange ? stat('Range', u.maxRange) : '',
    u.projectileSpeed ? stat('Proj. speed', fmt(u.projectileSpeed)) : '',
  ].join('');

  // The game's own render, upscaled from 64px — soft, but it's the only size
  // shipped and it reads far better than an icon at this size.
  const preview = state.previews.has(u.id)
    ? `<div class="preview" style="--fc:${FACTION_COLOURS[u.faction]}">
         <img src="/previews/${u.id}.png" alt="${u.name ?? u.displayName}" width="132" height="132" decoding="async">
       </div>`
    : '';

  return `
  <div class="detail-head">
    ${unitIcon(u.icon, u.faction, { size: 52, muted: u.status === 'no-model' })}
    <div>
      <h2>${u.name ?? shortName(u)}</h2>
      <div class="sub2">${u.displayName} · <code>${u.id}</code></div>
    </div>
    <button type="button" class="detail-close" id="detail-close" aria-label="Close">×</button>
  </div>
  ${preview}

  <div class="badges">
    <span class="badge" style="color:${FACTION_COLOURS[u.faction]};border-color:${FACTION_COLOURS[u.faction]}66">${u.faction}</span>
    ${u.tier ? `<span class="badge">Tier ${u.tier}</span>` : ''}
    <span class="badge">${u.domain}</span>
    ${u.role ? `<span class="badge">${u.role}</span>` : ''}
    ${u.status === 'in-game'
      ? ''
      : `<span class="badge warn">${STATUS_LABELS[u.status]}${u.statusReason ? ` — ${u.statusReason}` : ''}</span>`}
  </div>

  <div class="section"><h3>Cost &amp; core</h3><dl class="statgrid">${core}</dl></div>

  ${economySection(u)}
  ${adjacencySection(u)}
  ${weaponsSection(u)}
  ${shieldSection(u)}
  ${mobilitySection(u)}
  ${buildSection(u)}

  <div class="section">
    <h3>Tags</h3>
    <div class="unit-links">${u.tags.map((t) => `<span class="badge">${t}</span>`).join('')}</div>
  </div>`;
}

function economySection(u) {
  const lines = [];
  const res = (obj) => Object.entries(obj).map(([k, v]) => `${v}/s ${k}`).join(', ');

  if (u.production) lines.push(['Produces', res(u.production)]);
  if (u.upkeep) lines.push(['Upkeep', res(u.upkeep)]);
  if (u.storage) lines.push(['Storage', Object.entries(u.storage).map(([k, v]) => `${fmt(v)} ${k}`).join(', ')]);
  if (u.buildPower) lines.push(['Build power', u.buildPower]);
  if (!lines.length) return '';

  return section('Economy', `<dl class="kv">${lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`);
}

// Structures pass bonuses to whatever is built touching them. Only the granting
// side is in the templates, so this is shown on the generator/extractor rather
// than on the factory that benefits.
function adjacencySection(u) {
  if (!u.adjacency?.effects?.length) return '';

  const rows = u.adjacency.effects
    .map((e) => {
      const sign = e.percent < 0 ? '' : '+';
      const targets = e.targets.map((t) => t.replace(/_/g, ' ').toLowerCase()).join(' or ');
      return `<dt>${e.label}</dt><dd><strong class="${e.percent < 0 ? 'good' : 'good'}">${sign}${e.percent}%</strong> ${e.resource} · to adjacent ${targets}</dd>`;
    })
    .join('');

  return section(
    'Adjacency bonus',
    `<dl class="kv">${rows}</dl>
     <p class="hint">Applies to structures built directly against this one, and stacks per adjacent source.</p>`
  );
}

function weaponsSection(u) {
  const death = u.deathExplosion
    ? `<dl class="kv" style="margin-top:8px"><dt>Death explosion</dt>
       <dd>${fmt(u.deathExplosion.damage)} dmg${u.deathExplosion.radius ? ` · ${u.deathExplosion.radius} radius` : ''}</dd></dl>`
    : '';

  if (!u.weapons.length) return death ? section('Weapons', death) : '';

  const blocks = u.weapons.map((w) => {
    // Facts are only listed when the weapon actually has them, so a beam doesn't
    // show an empty speed and a single-shot gun doesn't show a salvo of one.
    // A continuous beam ignores reload entirely — it damages every tick it holds
    // the target — so listing a reload next to it would be actively misleading.
    const continuous = w.beamMode === 'continuous';
    const facts = [
      continuous ? null : w.reloadTime ? `${w.reloadTime}s reload` : null,
      `${w.rangeMax} range`,
      w.damageRadius ? `${w.damageRadius} radius` : null,
      w.isBeam ? beamLabel(w) : w.projectileSpeed ? `${fmt(w.projectileSpeed)} speed` : null,
      w.shotsPerCycle > 1 ? `${w.shotsPerCycle} shots/cycle` : null,
      w.salvoDelay ? `${w.salvoDelay}s between shots` : null,
    ].filter(Boolean);

    // A weapon with no traverse controller is bolted facing forward — worth
    // saying outright, since it changes how the unit has to be positioned.
    const aim = [
      w.traverseSpeed ? `${fmt(w.traverseSpeed)}°/s traverse` : 'fixed mount',
      w.elevationSpeed ? `${fmt(w.elevationSpeed)}°/s elevation` : null,
      w.traverseArc != null && w.traverseSpeed
        ? `${w.traverseArc}° arc${w.traverseArc >= 360 ? '' : ' (limited)'}`
        : null,
    ].filter(Boolean);

    return `<div class="weapon">
      <div class="weapon-top">
        ${w.count > 1 ? `<span class="wcount">×${w.count}</span>` : ''}
        <strong>${weaponLabel(w)}</strong>
        ${w.dpsTotal != null
          ? `<span class="wdps">${fmt(w.dpsTotal)} dps</span>`
          : '<span class="wdps" title="The template declares no muzzle bones, so the game scores this weapon zero">dps unknown</span>'}
      </div>
      <div class="weapon-facts">${facts.join(' · ')}</div>
      <div class="weapon-facts aim">${aim.join(' · ')}</div>
      ${w.targets.length ? `<div class="weapon-targets">Hits ${w.targets.join(', ')}</div>` : ''}
    </div>`;
  });

  return section('Weapons', blocks.join('') + death);
}

// Damage of 0 with a collider-based category means the damage lives on the
// projectile, not the weapon — say so rather than printing a bare "0 dmg".
function weaponLabel(w) {
  const kind = w.isBeam ? 'Beam' : w.category ? splitCamel(w.category) : null;
  if (w.damage <= 0) return `${kind ?? 'Weapon'} · damage on impact`;
  return kind ? `${fmt(w.damage)} dmg · ${kind}` : `${fmt(w.damage)} dmg`;
}

// Continuous beams damage every tick while held on target; pulse beams land a
// single tick per reload; burst beams land beamLifetime ticks per reload.
function beamLabel(w) {
  if (w.beamMode === 'continuous') return 'continuous beam';
  if (w.beamMode === 'burst') return `${w.beamLifetime}-tick beam`;
  return 'pulse beam';
}

// "AOEDelayedCluster" -> "AOE Delayed Cluster"; the first pass breaks an
// acronym off the word that follows it, the second splits ordinary humps.
const splitCamel = (s) =>
  s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z\d])([A-Z])/g, '$1 $2');

function shieldSection(u) {
  if (!u.shields.length) return '';
  return section(
    'Shields',
    u.shields
      .map(
        (s) => `<dl class="kv">
        <dt>${s.name}</dt><dd>${fmt(s.max)} hp</dd>
        ${s.radius ? `<dt>Radius</dt><dd>${s.radius}</dd>` : ''}
        ${s.regen ? `<dt>Regen</dt><dd>${s.regen}/s after ${s.regenDelay ?? 0}s</dd>` : ''}
      </dl>`
      )
      .join('')
  );
}

function mobilitySection(u) {
  const lines = [];
  if (u.movement) {
    lines.push(['Speed', u.movement.speed]);
    if (u.movement.acceleration) lines.push(['Acceleration', u.movement.acceleration]);
    if (u.movement.rotationSpeed) lines.push(['Turn rate', `${u.movement.rotationSpeed}°/s`]);
    if (u.movement.type) lines.push(['Movement', u.movement.type]);
  }
  if (u.vision) lines.push(['Vision', u.vision]);
  if (u.radar) lines.push(['Radar', u.radar]);
  if (u.sonar) lines.push(['Sonar', u.sonar]);
  if (u.transportSlots) lines.push(['Transport slots', u.transportSlots]);
  if (u.footprint) lines.push(['Footprint', `${u.footprint.x} × ${u.footprint.y}`]);
  if (!lines.length) return '';

  return section('Mobility &amp; intel', `<dl class="kv">${lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`);
}

function buildSection(u) {
  const chips = (ids) =>
    `<div class="unit-links">${ids
      .map((id) => {
        const t = state.byId.get(id);
        if (!t) return '';
        return `<button type="button" class="unit-link" data-id="${id}">
                  ${unitIcon(t.icon, t.faction, { size: 20, muted: t.status === 'no-model' })}${builderName(t)}</button>`;
      })
      .join('')}</div>`;

  const parts = [];

  if (u.builtBy.length) {
    // buildTime is in build-power-seconds, so the wall-clock time depends on
    // whichever builder is making it.
    const times = u.builtBy
      .map((id) => state.byId.get(id))
      .filter((b) => b?.buildPower)
      .map((b) => [builderName(b), `${(u.buildTime / b.buildPower).toFixed(1)}s`]);

    parts.push(`<h3>Built by</h3>${chips(u.builtBy)}`);
    if (times.length) parts.push(`<dl class="kv" style="margin-top:8px">${times
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('')}</dl>`);
  }

  if (u.builds.length) parts.push(`<h3 style="margin-top:16px">Can build</h3>${chips(u.builds)}`);
  if (u.upgradesTo) parts.push(`<h3 style="margin-top:16px">Upgrades to</h3>${chips([u.upgradesTo])}`);

  return parts.length ? `<div class="section">${parts.join('')}</div>` : '';
}

const section = (title, body) => `<div class="section"><h3>${title}</h3>${body}</div>`;

/* ---------------- events ---------------- */

function wireEvents() {
  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    render();
  });

  $('#filter-groups').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const set = state.filters[chip.dataset.group];
    const value = chip.dataset.value;
    set.has(value) ? set.delete(value) : set.add(value);
    chip.setAttribute('aria-pressed', String(set.has(value)));
    render();
  });

  $('#reset').addEventListener('click', () => {
    for (const set of Object.values(state.filters)) set.clear();
    state.filters.status = new Set([DEFAULT_STATUS]);
    state.search = '';
    $('#search').value = '';
    syncChips();
    render();
  });

  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    render();
  });

  $('#results').addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (card) openDetail(card.dataset.id);
  });

  $('#detail').addEventListener('click', (e) => {
    if (e.target.closest('#detail-close')) return closeDetail();
    const link = e.target.closest('.unit-link');
    if (link) openDetail(link.dataset.id);
  });

  $('#scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selected) closeDetail();
    if (e.key === '/' && document.activeElement !== $('#search')) {
      e.preventDefault();
      $('#search').focus();
    }
  });

  window.addEventListener('popstate', () => {
    readUrl();
    render();
  });
}

/* ---------------- url state ---------------- */
// Keeps filters and the open unit shareable and back-button friendly.

function writeUrl() {
  const p = new URLSearchParams();
  if (state.search) p.set('q', state.search);
  for (const [group, set] of Object.entries(state.filters)) {
    if (group === 'status') continue;
    if (set.size) p.set(group, [...set].join(','));
  }

  // Availability defaults to In game, so an empty set is a deliberate choice
  // and has to be written out — otherwise a reload would silently re-apply it.
  const status = state.filters.status;
  const isDefault = status.size === 1 && status.has(DEFAULT_STATUS);
  if (!isDefault) p.set('status', status.size ? [...status].join(',') : 'any');

  if (state.sort !== 'default') p.set('sort', state.sort);
  if (state.selected) p.set('unit', state.selected);

  const url = p.toString() ? `?${p}` : location.pathname;
  history.replaceState(null, '', url);
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.search = p.get('q') ?? '';
  $('#search').value = state.search;

  for (const group of Object.keys(state.filters)) {
    if (group === 'status') continue;
    state.filters[group] = new Set((p.get(group) ?? '').split(',').filter(Boolean));
  }

  const status = p.get('status');
  state.filters.status =
    status === null ? new Set([DEFAULT_STATUS]) : new Set(status === 'any' ? [] : status.split(',').filter(Boolean));

  syncChips();

  state.sort = METRICS[p.get('sort')] ? p.get('sort') : 'default';
  $('#sort').value = state.sort;

  state.selected = p.get('unit');
  if (state.selected) queueMicrotask(() => openDetail(state.selected));
}

function syncChips() {
  document.querySelectorAll('.chip').forEach((c) =>
    c.setAttribute('aria-pressed', String(state.filters[c.dataset.group]?.has(c.dataset.value) ?? false))
  );
}

/* ---------------- helpers ---------------- */

// Many structures have no proper name, only a "Tier 2: Land Factory" label.
function shortName(u) {
  return u.displayName.replace(/^Tier \d+:\s*/, '') || u.id;
}

// In the build tree the same structure appears once per tier, so "Land Factory"
// three times over is useless — keep the tier on anything without a real name.
function builderName(u) {
  if (u.name) return u.name;
  return u.tier ? `T${u.tier} ${shortName(u)}` : shortName(u);
}

function fmt(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

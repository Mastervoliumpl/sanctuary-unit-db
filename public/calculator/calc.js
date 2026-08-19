import { mountHeader, loadUnits, setMetaLine, duration, fmt } from '/shared/nav.js';

// Everything here follows the formulas the game documents in
// templateExplainations.lua:
//
//   buildTime / buildPower                        = seconds to build
//   resDrain(per tick) = cost / (buildTime / buildPower)
//
// Build power from assisting builders adds up, so N engineers on one target
// divide the time and multiply the drain by the same factor. Economy figures
// (production, maintenanceConsumption) are already per second.

const $ = (sel) => document.querySelector(sel);

const state = {
  units: [],
  byId: new Map(),
  target: null,
  builders: [], // [{ id, count }]
  economy: [], // [{ id, count }]
};

init();

async function init() {
  mountHeader({ subtitle: 'Loading…' });

  const data = await loadUnits();
  state.units = data.units;
  state.byId = new Map(data.units.map((u) => [u.id, u]));

  setMetaLine(
    `${data.units.filter((u) => u.buildPower).length} builders · ` +
      `${data.units.filter((u) => u.production).length} producers · ` +
      `extracted ${new Date(data.meta.generatedAt).toLocaleDateString()}`
  );

  populate();
  restore();
  wire();
  render();
}

/* ---------------- unit pools ---------------- */

// Anything with a build power can contribute to a build; anything with
// production, upkeep or storage is worth putting in the economy panel.
const isBuilder = (u) => u.buildPower > 0;
const isEconomic = (u) => u.production || u.upkeep || u.storage;
const buildable = (u) => u.buildTime > 0 && (u.cost.alloys > 0 || u.cost.energy > 0);

const nameOf = (u) => {
  const base = u.name ?? u.displayName.replace(/^Tier \d+:\s*/, '') ?? u.id;
  return `${u.faction} · ${u.tier ? `T${u.tier} ` : ''}${base}`;
};

function optionsFor(filter) {
  return state.units
    .filter(filter)
    .filter((u) => u.status !== 'no-model')
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    .map((u) => `<option value="${u.id}">${nameOf(u)}</option>`)
    .join('');
}

function populate() {
  $('#target').innerHTML = optionsFor(buildable);
  $('#builder-pick').innerHTML = optionsFor(isBuilder);
  $('#econ-pick').innerHTML = optionsFor(isEconomic);
}

/* ---------------- maths ---------------- */

const totalBuildPower = () =>
  state.builders.reduce((sum, row) => sum + (state.byId.get(row.id)?.buildPower ?? 0) * row.count, 0);

function buildResult() {
  const target = state.byId.get(state.target);
  const power = totalBuildPower();
  if (!target || power <= 0) return null;

  const seconds = target.buildTime / power;
  return {
    target,
    power,
    seconds,
    // Drain is the whole cost spread over the build, so it scales with power.
    alloysPerSec: target.cost.alloys / seconds,
    energyPerSec: target.cost.energy / seconds,
  };
}

function economyResult() {
  const totals = {
    alloysIn: 0, energyIn: 0,
    alloysOut: 0, energyOut: 0,
    alloysStore: 0, energyStore: 0,
  };

  for (const row of state.economy) {
    const u = state.byId.get(row.id);
    if (!u) continue;
    totals.alloysIn += (u.production?.alloys ?? 0) * row.count;
    totals.energyIn += (u.production?.energy ?? 0) * row.count;
    totals.alloysOut += (u.upkeep?.alloys ?? 0) * row.count;
    totals.energyOut += (u.upkeep?.energy ?? 0) * row.count;
    totals.alloysStore += (u.storage?.alloys ?? 0) * row.count;
    totals.energyStore += (u.storage?.energy ?? 0) * row.count;
  }

  return {
    ...totals,
    alloysNet: totals.alloysIn - totals.alloysOut,
    energyNet: totals.energyIn - totals.energyOut,
  };
}

/* ---------------- rendering ---------------- */

function render() {
  renderRows('#builders', state.builders, 'builder');
  renderRows('#economy', state.economy, 'economy');
  renderBuild();
  renderEconomy();
  renderVerdict();
  save();
}

function renderRows(sel, rows, kind) {
  if (!rows.length) {
    $(sel).innerHTML = `<p class="empty-row">None added yet.</p>`;
    return;
  }
  $(sel).innerHTML = rows
    .map((row, i) => {
      const u = state.byId.get(row.id);
      const detail =
        kind === 'builder'
          ? `${fmt(u.buildPower)} build power each`
          : [
              u.production ? `+${describeRates(u.production)}` : null,
              u.upkeep ? `−${describeRates(u.upkeep)}` : null,
              u.storage ? `${describeAmounts(u.storage)} storage` : null,
            ]
              .filter(Boolean)
              .join(' · ');

      return `<div class="row">
        <span class="row-name">${nameOf(u)}<small>${detail}</small></span>
        <span class="row-controls">
          <button type="button" data-act="dec" data-kind="${kind}" data-i="${i}" aria-label="Fewer">−</button>
          <b>${row.count}</b>
          <button type="button" data-act="inc" data-kind="${kind}" data-i="${i}" aria-label="More">+</button>
          <button type="button" class="drop" data-act="del" data-kind="${kind}" data-i="${i}" aria-label="Remove">×</button>
        </span>
      </div>`;
    })
    .join('');
}

const describeRates = (obj) =>
  Object.entries(obj).map(([k, v]) => `${fmt(v)} ${k}/s`).join(', ');
const describeAmounts = (obj) =>
  Object.entries(obj).map(([k, v]) => `${fmt(v, 0)} ${k}`).join(', ');

function renderBuild() {
  const r = buildResult();
  if (!r) {
    $('#build-out').innerHTML = `<p class="empty-row">Pick a target and add at least one builder.</p>`;
    return;
  }
  $('#build-out').innerHTML = `
    <dl class="statgrid">
      <div><dt>Time</dt><dd>${duration(r.seconds)}</dd></div>
      <div><dt>Build power</dt><dd>${fmt(r.power)}</dd></div>
      <div><dt>Alloys/s</dt><dd class="alloy-val">${fmt(r.alloysPerSec)}</dd></div>
      <div><dt>Energy/s</dt><dd class="energy-val">${fmt(r.energyPerSec)}</dd></div>
      <div><dt>Total alloys</dt><dd class="alloy-val">${fmt(r.target.cost.alloys, 0)}</dd></div>
      <div><dt>Total energy</dt><dd class="energy-val">${fmt(r.target.cost.energy, 0)}</dd></div>
    </dl>`;
}

function renderEconomy() {
  const e = economyResult();
  if (!state.economy.length) {
    $('#econ-out').innerHTML = `<p class="empty-row">Add structures to see net income.</p>`;
    return;
  }
  const net = (v) => `<dd class="${v < 0 ? 'bad' : 'good'}">${v > 0 ? '+' : ''}${fmt(v)}</dd>`;
  $('#econ-out').innerHTML = `
    <dl class="statgrid">
      <div><dt>Net alloys/s</dt>${net(e.alloysNet)}</div>
      <div><dt>Net energy/s</dt>${net(e.energyNet)}</div>
      <div><dt>Alloy storage</dt><dd>${fmt(e.alloysStore, 0)}</dd></div>
      <div><dt>Energy storage</dt><dd>${fmt(e.energyStore, 0)}</dd></div>
    </dl>
    <dl class="kv" style="margin-top:10px">
      <dt>Gross production</dt><dd>${fmt(e.alloysIn)} alloys/s · ${fmt(e.energyIn)} energy/s</dd>
      <dt>Upkeep</dt><dd>${fmt(e.alloysOut)} alloys/s · ${fmt(e.energyOut)} energy/s</dd>
    </dl>`;
}

// The interesting question isn't "what does it cost" but "can my economy
// sustain it" — a build drawing more than net income stalls and stretches out.
function renderVerdict() {
  const b = buildResult();
  const e = economyResult();

  if (!b || !state.economy.length) {
    $('#verdict').innerHTML = `<p class="empty-row">Fill in both panels above.</p>`;
    return;
  }

  const lines = [['alloys', b.alloysPerSec, e.alloysNet], ['energy', b.energyPerSec, e.energyNet]].map(
    ([res, need, have]) => {
      const ok = have >= need;
      // Time stretches by the ratio of demand to supply once you run dry.
      const stretched = have > 0 ? b.seconds * (need / have) : Infinity;
      return `<dt>${res[0].toUpperCase() + res.slice(1)}</dt>
        <dd class="${ok ? 'good' : 'bad'}">
          needs ${fmt(need)}/s, income ${fmt(have)}/s —
          ${ok ? 'sustained' : have > 0 ? `stalls, ~${duration(stretched)} at this income` : 'no income'}
        </dd>`;
    }
  );

  const bottleneck = Math.max(
    e.alloysNet > 0 ? b.alloysPerSec / e.alloysNet : Infinity,
    e.energyNet > 0 ? b.energyPerSec / e.energyNet : Infinity
  );
  const realTime = bottleneck > 1 ? b.seconds * bottleneck : b.seconds;

  $('#verdict').innerHTML = `
    <dl class="kv">${lines.join('')}</dl>
    <dl class="statgrid" style="margin-top:12px">
      <div><dt>Unconstrained</dt><dd>${duration(b.seconds)}</dd></div>
      <div><dt>At this income</dt><dd class="${bottleneck > 1 ? 'bad' : 'good'}">${duration(realTime)}</dd></div>
    </dl>`;
}

/* ---------------- events & persistence ---------------- */

function wire() {
  $('#target').addEventListener('change', (e) => {
    state.target = e.target.value;
    render();
  });

  $('#builder-add').addEventListener('click', () => addRow(state.builders, $('#builder-pick').value));
  $('#econ-add').addEventListener('click', () => addRow(state.economy, $('#econ-pick').value));

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const rows = btn.dataset.kind === 'builder' ? state.builders : state.economy;
    const i = Number(btn.dataset.i);

    if (btn.dataset.act === 'inc') rows[i].count++;
    if (btn.dataset.act === 'dec') rows[i].count = Math.max(1, rows[i].count - 1);
    if (btn.dataset.act === 'del') rows.splice(i, 1);
    render();
  });
}

function addRow(rows, id) {
  if (!id) return;
  const existing = rows.find((r) => r.id === id);
  existing ? existing.count++ : rows.push({ id, count: 1 });
  render();
}

// Kept in the URL so a setup can be shared or bookmarked.
function save() {
  const p = new URLSearchParams();
  if (state.target) p.set('t', state.target);
  const pack = (rows) => rows.map((r) => `${r.id}:${r.count}`).join(',');
  if (state.builders.length) p.set('b', pack(state.builders));
  if (state.economy.length) p.set('e', pack(state.economy));
  history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
}

function restore() {
  const p = new URLSearchParams(location.search);
  const unpack = (raw) =>
    (raw ?? '')
      .split(',')
      .filter(Boolean)
      .map((chunk) => {
        const [id, count] = chunk.split(':');
        return { id, count: Math.max(1, Number(count) || 1) };
      })
      .filter((r) => state.byId.has(r.id));

  state.builders = unpack(p.get('b'));
  state.economy = unpack(p.get('e'));

  const target = p.get('t');
  state.target = state.byId.has(target) ? target : $('#target').options[0]?.value ?? null;
  if (state.target) $('#target').value = state.target;
}

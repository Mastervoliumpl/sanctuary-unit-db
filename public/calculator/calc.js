import { mountHeader, loadUnits, setMetaLine, duration, fmt } from '/shared/nav.js';
import { combobox } from '/shared/combo.js';

// Follows the formulas the game documents in templateExplainations.lua:
//
//   buildTime / buildPower                       = seconds to build
//   resDrain(per tick) = cost / (buildTime / buildPower)
//
// Who can build what is not a free choice: a target's `builtBy` list comes from
// resolving every builder's canBuild tag expression, so a T1 air factory simply
// cannot start a T4 bot. Assisting is separate — any unit with the Assist order
// and build power can pour into someone else's build, including one it could
// never have started itself, so those two roles are picked from different pools.

const $ = (sel) => document.querySelector(sel);

const state = {
  units: [],
  byId: new Map(),
  target: null,
  primary: null,
  assists: [], // [{ id, count }]
  economy: [], // [{ id, count }]
};

let targetCombo;
let primaryCombo;
let assistCombo;
let econCombo;

init();

async function init() {
  mountHeader({ subtitle: 'Loading…' });

  const data = await loadUnits();
  state.units = data.units;
  state.byId = new Map(data.units.map((u) => [u.id, u]));

  setMetaLine(
    `${data.units.filter((u) => u.builtBy.length).length} buildable · ` +
      `${data.units.filter((u) => u.canAssist).length} can assist · ` +
      `extracted ${new Date(data.meta.generatedAt).toLocaleDateString()}`
  );

  restore();
  mountCombos();
  wire();
  render();
}

/* ---------------- pools ---------------- */

const shown = (u) => u.status !== 'no-model';
const buildable = (u) => u.builtBy.length > 0 && u.buildTime > 0;
const canAssist = (u) => u.canAssist && u.buildPower > 0;
const isEconomic = (u) => u.production || u.upkeep || u.storage;

const nameOf = (u) =>
  `${u.faction} · ${u.tier ? `T${u.tier} ` : ''}${u.name ?? u.displayName.replace(/^Tier \d+:\s*/, '') ?? u.id}`;

const toOption = (u, hint) => ({
  value: u.id,
  label: nameOf(u),
  hint: hint?.(u) ?? '',
  // Ids and internal names are searchable too, since people quote them.
  search: [nameOf(u), u.id, u.displayName, u.internalName].filter(Boolean).join(' ').toLowerCase(),
});

const sortOpts = (list) => list.sort((a, b) => a.label.localeCompare(b.label));

const targetOptions = () =>
  sortOpts(state.units.filter((u) => shown(u) && buildable(u)).map((u) => toOption(u)));

// Only what the game says can actually start this build.
const primaryOptions = () => {
  const target = state.byId.get(state.target);
  if (!target) return [];
  return sortOpts(
    target.builtBy
      .map((id) => state.byId.get(id))
      .filter(Boolean)
      .map((u) => toOption(u, (b) => `${fmt(b.buildPower)} build power`))
  );
};

const assistOptions = () =>
  sortOpts(
    state.units
      .filter((u) => shown(u) && canAssist(u))
      .map((u) => toOption(u, (b) => `${fmt(b.buildPower)} build power`))
  );

const econOptions = () =>
  sortOpts(state.units.filter((u) => shown(u) && isEconomic(u)).map((u) => toOption(u)));

/* ---------------- maths ---------------- */

function buildResult() {
  const target = state.byId.get(state.target);
  const primary = state.byId.get(state.primary);
  if (!target || !primary) return null;

  const assistPower = state.assists.reduce(
    (sum, row) => sum + (state.byId.get(row.id)?.buildPower ?? 0) * row.count,
    0
  );
  const power = primary.buildPower + assistPower;
  if (power <= 0) return null;

  const seconds = target.buildTime / power;
  return {
    target,
    primary,
    power,
    assistPower,
    seconds,
    alloysPerSec: target.cost.alloys / seconds,
    energyPerSec: target.cost.energy / seconds,
  };
}

function economyResult() {
  const t = { alloysIn: 0, energyIn: 0, alloysOut: 0, energyOut: 0, alloysStore: 0, energyStore: 0 };
  for (const row of state.economy) {
    const u = state.byId.get(row.id);
    if (!u) continue;
    t.alloysIn += (u.production?.alloys ?? 0) * row.count;
    t.energyIn += (u.production?.energy ?? 0) * row.count;
    t.alloysOut += (u.upkeep?.alloys ?? 0) * row.count;
    t.energyOut += (u.upkeep?.energy ?? 0) * row.count;
    t.alloysStore += (u.storage?.alloys ?? 0) * row.count;
    t.energyStore += (u.storage?.energy ?? 0) * row.count;
  }
  return { ...t, alloysNet: t.alloysIn - t.alloysOut, energyNet: t.energyIn - t.energyOut };
}

/* ---------------- combos ---------------- */

function mountCombos() {
  targetCombo = combobox($('#target'), {
    options: targetOptions(),
    value: state.target,
    placeholder: 'Search units…',
    onPick: (id) => {
      state.target = id;
      // The valid builders change with the target, and the previous pick may no
      // longer be able to start this build.
      state.primary = primaryCombo.setOptions(primaryOptions(), true);
      render();
    },
  });
  state.target = targetCombo.value;

  primaryCombo = combobox($('#primary'), {
    options: primaryOptions(),
    value: state.primary,
    placeholder: 'Search builders…',
    empty: 'Nothing in the game can build this',
    onPick: (id) => { state.primary = id; render(); },
  });
  state.primary = primaryCombo.value;

  assistCombo = combobox($('#assist-pick'), {
    options: assistOptions(),
    value: null,
    placeholder: 'Search assisting units…',
  });

  econCombo = combobox($('#econ-pick'), {
    options: econOptions(),
    value: null,
    placeholder: 'Search structures…',
  });
}

/* ---------------- rendering ---------------- */

function render() {
  renderRows('#assists', state.assists, 'assist');
  renderRows('#economy', state.economy, 'economy');
  renderBuild();
  renderEconomy();
  renderVerdict();
  save();
}

function renderRows(sel, rows, kind) {
  if (!rows.length) {
    $(sel).innerHTML = `<p class="empty-row">None added.</p>`;
    return;
  }
  $(sel).innerHTML = rows
    .map((row, i) => {
      const u = state.byId.get(row.id);
      const detail =
        kind === 'assist'
          ? `${fmt(u.buildPower)} build power each`
          : [
              u.production ? `+${rates(u.production)}` : null,
              u.upkeep ? `−${rates(u.upkeep)}` : null,
              u.storage ? `${amounts(u.storage)} storage` : null,
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

const rates = (o) => Object.entries(o).map(([k, v]) => `${fmt(v)} ${k}/s`).join(', ');
const amounts = (o) => Object.entries(o).map(([k, v]) => `${fmt(v, 0)} ${k}`).join(', ');

function renderBuild() {
  const r = buildResult();
  if (!r) {
    $('#build-out').innerHTML = `<p class="empty-row">Pick something to build and who builds it.</p>`;
    return;
  }
  $('#build-out').innerHTML = `
    <dl class="statgrid">
      <div><dt>Time</dt><dd>${duration(r.seconds)}</dd></div>
      <div><dt>Build power</dt><dd>${fmt(r.power)}${
        r.assistPower ? `<small> (${fmt(r.primary.buildPower)} + ${fmt(r.assistPower)})</small>` : ''
      }</dd></div>
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

// The useful question isn't the cost, it's whether the economy sustains it — a
// build drawing more than net income stalls and stretches out.
function renderVerdict() {
  const b = buildResult();
  const e = economyResult();

  if (!b || !state.economy.length) {
    $('#verdict').innerHTML = `<p class="empty-row">Fill in both panels above.</p>`;
    return;
  }

  const lines = [['Alloys', b.alloysPerSec, e.alloysNet], ['Energy', b.energyPerSec, e.energyNet]]
    .map(([res, need, have]) => {
      const ok = have >= need;
      const stretched = have > 0 ? b.seconds * (need / have) : Infinity;
      return `<dt>${res}</dt>
        <dd class="${ok ? 'good' : 'bad'}">needs ${fmt(need)}/s, income ${fmt(have)}/s —
          ${ok ? 'sustained' : have > 0 ? `stalls, ~${duration(stretched)} at this income` : 'no income'}</dd>`;
    })
    .join('');

  const worst = Math.max(
    e.alloysNet > 0 ? b.alloysPerSec / e.alloysNet : Infinity,
    e.energyNet > 0 ? b.energyPerSec / e.energyNet : Infinity
  );
  const real = worst > 1 ? b.seconds * worst : b.seconds;
  // With no income of a resource the build never finishes, which reads better
  // than the em dash a non-finite duration would produce.
  const realLabel = Number.isFinite(real) ? duration(real) : 'never';

  $('#verdict').innerHTML = `
    <dl class="kv">${lines}</dl>
    <dl class="statgrid" style="margin-top:12px">
      <div><dt>Unconstrained</dt><dd>${duration(b.seconds)}</dd></div>
      <div><dt>At this income</dt><dd class="${worst > 1 ? 'bad' : 'good'}">${realLabel}</dd></div>
    </dl>`;
}

/* ---------------- events & persistence ---------------- */

function wire() {
  $('#assist-add').addEventListener('click', () => addRow(state.assists, assistCombo.value));
  $('#econ-add').addEventListener('click', () => addRow(state.economy, econCombo.value));

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const rows = btn.dataset.kind === 'assist' ? state.assists : state.economy;
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

function save() {
  const p = new URLSearchParams();
  if (state.target) p.set('t', state.target);
  if (state.primary) p.set('p', state.primary);
  const pack = (rows) => rows.map((r) => `${r.id}:${r.count}`).join(',');
  if (state.assists.length) p.set('a', pack(state.assists));
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

  state.assists = unpack(p.get('a'));
  state.economy = unpack(p.get('e'));

  const target = p.get('t');
  state.target = state.byId.get(target) && buildable(state.byId.get(target)) ? target : null;

  // Only honour a saved builder if it can actually build the saved target.
  const primary = p.get('p');
  state.primary = state.byId.get(state.target)?.builtBy.includes(primary) ? primary : null;
}

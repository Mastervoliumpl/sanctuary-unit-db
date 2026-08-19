// Reports what a re-extract actually changed, by comparing the working-tree
// public/data/units.json against the last committed version. Run automatically
// at the end of `npm run refresh`, or on its own with `npm run diff`.
//
// The point: after a game patch, "the file changed" is useless — you want to
// know it's 17 balance tweaks and 2 new units before you commit, and a diff
// that says every DPS moved is an extractor regression, not a patch.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'public/data/units.json';

// Fields worth calling out by name; everything else folds into a count.
const HEADLINE = [
  'name', 'displayName', 'status', 'tier', 'health', 'buildTime', 'dps',
  'maxRange', 'buildPower', 'cost.alloys', 'cost.energy',
];

function main() {
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, REL), 'utf8'));

  let committed;
  try {
    committed = JSON.parse(
      execFileSync('git', ['show', `HEAD:${REL}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' })
    );
  } catch {
    console.log('No committed units.json to compare against (first extract?) — skipping diff.');
    return;
  }

  const before = new Map(committed.units.map((u) => [u.id, u]));
  const after = new Map(current.units.map((u) => [u.id, u]));

  const added = [...after.values()].filter((u) => !before.has(u.id));
  const removed = [...before.values()].filter((u) => !after.has(u.id));

  const changed = [];
  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) continue;
    const diffs = diffUnit(was, now);
    if (diffs.length) changed.push({ id, name: label(now), diffs });
  }

  if (!added.length && !removed.length && !changed.length) {
    console.log(`units.json matches HEAD — nothing changed beyond metadata.`);
    return;
  }

  console.log(`units.json vs HEAD (${committed.meta?.generatedAt?.slice(0, 10) ?? '?'} → ${current.meta?.generatedAt?.slice(0, 10) ?? '?'}):\n`);

  if (added.length) {
    console.log(`  ${added.length} added:`);
    for (const u of added) console.log(`    + ${u.id}  ${label(u)}`);
  }
  if (removed.length) {
    console.log(`  ${removed.length} removed:`);
    for (const u of removed) console.log(`    - ${u.id}  ${label(u)}`);
  }

  if (changed.length) {
    console.log(`  ${changed.length} changed:`);
    const MAX_UNITS = 60;
    for (const c of changed.slice(0, MAX_UNITS)) {
      console.log(`    ~ ${c.id}  ${c.name}: ${c.diffs.join(', ')}`);
    }
    if (changed.length > MAX_UNITS) console.log(`    …and ${changed.length - MAX_UNITS} more`);
  }

  // A sanity line for spotting extractor regressions: a real patch touches a
  // slice of the roster; the extractor breaking tends to touch all of it.
  const touched = added.length + removed.length + changed.length;
  console.log(`\n  ${touched}/${after.size} units differ. If that looks like "everything", suspect the extractor before the patch notes.`);
}

function label(u) {
  return u.name ?? u.displayName ?? '';
}

function diffUnit(was, now) {
  const out = [];

  for (const field of HEADLINE) {
    const a = get(was, field);
    const b = get(now, field);
    if (!same(a, b)) out.push(`${field} ${fmt(a)} → ${fmt(b)}`);
  }

  // Everything else — weapons, movement, tags, build tree — as one count, by
  // comparing the unit minus the headline fields.
  const restA = JSON.stringify(strip(was));
  const restB = JSON.stringify(strip(now));
  if (restA !== restB) out.push('other fields differ');

  return out;
}

const get = (obj, dotted) => dotted.split('.').reduce((o, k) => o?.[k], obj);

function strip(u) {
  const clone = structuredClone(u);
  for (const field of HEADLINE) {
    const parts = field.split('.');
    let o = clone;
    for (const p of parts.slice(0, -1)) o = o?.[p];
    if (o) delete o[parts.at(-1)];
  }
  return clone;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fmt = (v) => (v == null ? '∅' : typeof v === 'number' ? v.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(v));

main();

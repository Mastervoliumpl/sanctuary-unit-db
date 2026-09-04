// Checks that everything the deployed site needs is present and consistent.
//
// Deliberately reads only public/ — no game install, no icons-src — so it runs
// anywhere, including on a clean checkout or in CI. Run it before deploying;
// `npm run refresh` is the thing that needs the game, and this is how you
// confirm its output actually landed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const problems = [];
const notes = [];

const fail = (msg) => problems.push(msg);
const read = (rel) => JSON.parse(fs.readFileSync(path.join(PUBLIC, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(PUBLIC, rel));

function main() {
  // The app itself is built from src/ by Vite; public/ carries only the
  // generated data and art the build copies through verbatim.
  if (!exists('data/units.json')) {
    fail('missing data/units.json — run `npm run extract` against a local game install');
    return report();
  }

  const data = read('data/units.json');
  const units = data.units ?? [];
  if (!units.length) fail('data/units.json contains no units');

  notes.push(`${units.length} units, extracted ${(data.meta?.generatedAt ?? '').slice(0, 10) || 'unknown'}`);
  if (data.meta?.game) notes.push(`Steam build ${data.meta.game.buildId} (${data.meta.game.name})`);
  else notes.push('no Steam build id recorded — the site cannot say whether the data is current');
  if (!exists('data/version.json')) fail('missing data/version.json — re-run `npm run extract`');
  if (data.meta?.isDemo) notes.push('source is the demo build — balance values are provisional');

  checkIcons(units);
  checkPreviews(units);
  report();
}

function checkIcons(units) {
  if (!exists('icons/manifest.json')) {
    fail('missing icons/manifest.json — run `npm run icons`');
    return;
  }
  const manifest = new Set(read('icons/manifest.json'));
  const factions = ['eda', 'chosen', 'guard'];

  // Every listed combo must have a file for every faction, or units of that
  // faction silently render a broken image rather than falling back to SVG.
  let missingFiles = 0;
  for (const combo of manifest) {
    for (const faction of factions) {
      if (!exists(`icons/${faction}/${combo}.png`)) {
        if (missingFiles < 5) fail(`icons/${faction}/${combo}.png listed in manifest but absent`);
        missingFiles++;
      }
    }
  }
  if (missingFiles > 5) fail(`…and ${missingFiles - 5} more missing icon files`);

  const onArtwork = units.filter((u) => manifest.has(comboOf(u))).length;
  const modelledOnSvg = units.filter((u) => u.hasModel && !manifest.has(comboOf(u)));
  notes.push(`${onArtwork}/${units.length} units on extracted icons, rest fall back to generated SVG`);
  if (modelledOnSvg.length) {
    notes.push(
      `${modelledOnSvg.length} modelled units use the SVG icon fallback: ${modelledOnSvg.map((u) => u.id).join(', ')}`,
    );
  }
}

function checkPreviews(units) {
  if (!exists('previews/manifest.json')) {
    fail('missing previews/manifest.json — run `npm run icons`');
    return;
  }
  const manifest = read('previews/manifest.json');

  let missing = 0;
  for (const id of manifest) {
    if (!exists(`previews/${id}.png`)) {
      if (missing < 5) fail(`previews/${id}.png listed in manifest but absent`);
      missing++;
    }
  }
  if (missing > 5) fail(`…and ${missing - 5} more missing preview files`);

  const known = new Set(units.map((u) => u.id));
  const orphans = manifest.filter((id) => !known.has(id));
  if (orphans.length)
    notes.push(`${orphans.length} previews have no matching unit (harmless, just dead weight)`);

  // hasModel is "has art", which is broader than status === 'in-game' — an
  // in-progress unit is modelled but not enabled, and still needs a preview.
  const modelled = units.filter((u) => u.hasModel);
  const covered = modelled.filter((u) => manifest.includes(u.id)).length;
  notes.push(`${covered}/${modelled.length} modelled units have a preview render`);

  const statuses = units.reduce((acc, u) => ((acc[u.status] = (acc[u.status] ?? 0) + 1), acc), {});
  notes.push(
    `status split: ${statuses['in-game'] ?? 0} in game, ` +
      `${statuses['in-progress'] ?? 0} in progress, ${statuses['no-model'] ?? 0} no model`,
  );
}

const comboOf = (u) => `${u.icon?.shape}_${u.icon?.tech}_${u.icon?.symbol}`;

function report() {
  for (const note of notes) console.log(`  ${note}`);
  if (!problems.length) {
    console.log('\nOK — public/ data and art are complete and consistent, safe to deploy.');
    return;
  }
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exitCode = 1;
}

main();

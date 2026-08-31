// Publishes a community map to the site. Takes a map zip (or the raw map
// folder), reads the metadata the map already carries — the .sanmap file is
// plain JSON with name, credits, dimensions and armies, and every map ships
// its own preview.png — then writes that into public/ for the /maps page and
// stores the zip itself as a GitHub release asset, so map downloads never
// bloat the repo and download counts come free from the GitHub API.
//
//   npm run addmap -- <map.zip | map-folder> [--shots a.jpg b.png ...]
//                     [--desc "text"] [--dry-run]
//
// Re-running for the same map bumps its version and replaces the asset.
// Like extract.js this runs only on a local machine; production serves the
// committed public/ directory as-is.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { autoLevels, decodePng, encodePng } from './png-levels.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const MAPS_JSON = path.join(PUBLIC, 'data', 'maps.json');

// Git Bash's GNU tar can't read zips; Windows' own bsdtar can.
const TAR =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

/* ---------------- args ---------------- */

const args = process.argv.slice(2);
const flags = { shots: [], desc: null, dryRun: false };
let input = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dry-run') flags.dryRun = true;
  else if (a === '--desc') flags.desc = args[++i] ?? '';
  else if (a === '--shots') {
    while (args[i + 1] && !args[i + 1].startsWith('--')) flags.shots.push(args[++i]);
  } else if (!a.startsWith('--') && !input) input = a;
  else fail(`Unknown argument: ${a}`);
}
if (!input)
  fail('Usage: npm run addmap -- <map.zip | map-folder> [--shots img...] [--desc "text"] [--dry-run]');
input = path.resolve(input);
if (!fs.existsSync(input)) fail(`Not found: ${input}`);
for (const s of flags.shots) if (!fs.existsSync(s)) fail(`Screenshot not found: ${s}`);

/* ---------------- stage the map folder ---------------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctuary-map-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

let mapDir; // the map's own folder (contains the .sanmap)
let zipPath; // the zip to publish

if (fs.statSync(input).isDirectory()) {
  mapDir = input;
  zipPath = null; // created after the slug is known
} else {
  if (!/\.zip$/i.test(input)) fail(`Expected a .zip or a folder, got: ${path.basename(input)}`);
  const unpacked = path.join(tmp, 'unpacked');
  fs.mkdirSync(unpacked);
  const res = spawnSync(TAR, ['-xf', input, '-C', unpacked], { stdio: 'inherit' });
  if (res.status !== 0) fail(`Could not extract ${input}`);
  const roots = fs.readdirSync(unpacked).filter((n) => fs.statSync(path.join(unpacked, n)).isDirectory());
  if (roots.length !== 1)
    fail(
      `The zip must contain exactly one map folder at its root ` +
        `(found ${roots.length ? roots.join(', ') : 'loose files'}).`,
    );
  mapDir = path.join(unpacked, roots[0]);
  zipPath = input;
}

/* ---------------- read what the map says about itself ---------------- */

const sanmaps = fs.readdirSync(mapDir).filter((n) => n.endsWith('.sanmap'));
if (sanmaps.length !== 1)
  fail(`Expected exactly one .sanmap in ${path.basename(mapDir)}/, found ${sanmaps.length}.`);
const san = JSON.parse(fs.readFileSync(path.join(mapDir, sanmaps[0]), 'utf8'));

const folderName = path.basename(mapDir);
const slug = folderName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
if (!slug) fail(`Could not derive a slug from folder name "${folderName}".`);

const previewSrc = ['preview.png', path.join('Textures', 'preview.png')]
  .map((p) => path.join(mapDir, p))
  .find((p) => fs.existsSync(p));
if (!previewSrc) fail(`${folderName}/ has no preview.png — the game writes one when the map is saved.`);

const meta = {
  slug,
  name: san.name || folderName.replace(/_/g, ' '),
  author: san.credits || '',
  players: Object.keys(san.armies ?? {}).length,
  width: san.width ?? 0,
  length: san.length ?? 0,
  hasWater: Boolean(san.hasWater),
};
if (!meta.players) fail(`${sanmaps[0]} has no armies — is this a finished map?`);

/* ---------------- make sure there is a zip ---------------- */

if (!zipPath) {
  zipPath = path.join(tmp, `${slug}.zip`);
  const res = spawnSync(TAR, ['-a', '-cf', zipPath, '-C', path.dirname(mapDir), folderName], {
    stdio: 'inherit',
  });
  if (res.status !== 0) fail(`Could not create ${zipPath}`);
}
const sizeBytes = fs.statSync(zipPath).size;
const assetName = `${slug}.zip`;

/* ---------------- update maps.json + copied art ---------------- */

const repo = originRepo();
const db = fs.existsSync(MAPS_JSON)
  ? JSON.parse(fs.readFileSync(MAPS_JSON, 'utf8'))
  : { repo, updatedAt: '', maps: [] };
db.repo = repo;

const now = new Date().toISOString();
const existing = db.maps.find((m) => m.slug === slug);

const outDir = path.join(PUBLIC, 'maps', slug);
fs.mkdirSync(outDir, { recursive: true });
writePreview(previewSrc, path.join(outDir, 'preview.png'));

let screenshots = existing?.screenshots ?? [];
if (flags.shots.length) {
  for (const old of screenshots) fs.rmSync(path.join(outDir, old), { force: true });
  screenshots = flags.shots.map((src, i) => {
    const name = `shot-${i + 1}${path.extname(src).toLowerCase()}`;
    fs.copyFileSync(src, path.join(outDir, name));
    return name;
  });
}

const entry = {
  slug,
  name: meta.name,
  author: meta.author,
  description: flags.desc ?? existing?.description ?? '',
  players: meta.players,
  width: meta.width,
  length: meta.length,
  hasWater: meta.hasWater,
  version: (existing?.version ?? 0) + 1,
  sizeBytes,
  addedAt: existing?.addedAt ?? now,
  updatedAt: now,
  screenshots,
  tag: `map-${slug}`,
  download: `https://github.com/${repo}/releases/download/map-${slug}/${assetName}`,
};
db.maps = [...db.maps.filter((m) => m.slug !== slug), entry].sort((a, b) => a.slug.localeCompare(b.slug));
db.updatedAt = now;

/* ---------------- publish the zip as a release asset ---------------- */

if (flags.dryRun) {
  console.log('\n[dry-run] skipping the GitHub release upload');
} else {
  await publishAsset(repo, entry.tag, meta.name, zipPath, assetName);
}

fs.writeFileSync(MAPS_JSON, JSON.stringify(db, null, 2) + '\n');

console.log(`\n${existing ? 'updated' : 'added'}:   ${meta.name} (v${entry.version})`);
console.log(`slug:      ${slug}`);
console.log(`players:   ${meta.players}   size: ${meta.width}x${meta.length}   water: ${meta.hasWater}`);
console.log(`zip:       ${(sizeBytes / 1048576).toFixed(1)} MB -> ${entry.download}`);
if (screenshots.length) console.log(`shots:     ${screenshots.join(', ')}`);
console.log(`\nNow commit and push public/ so the site picks it up.`);

/* ---------------- preview art ---------------- */

// The site's copy of the preview, not the one inside the zip: converted maps
// arrive underexposed (a whole card of one reads as an empty rectangle), and
// the game writes these barely compressed. Levelling and re-deflating fixes
// both. Anything unexpected about the PNG is not worth failing a publish over
// — fall back to copying it as-is.
function writePreview(src, dest) {
  try {
    const img = decodePng(fs.readFileSync(src));
    const adjusted = autoLevels(img);
    const out = encodePng(img);
    fs.writeFileSync(dest, out);
    if (adjusted) console.log(`preview:   levelled (${adjusted.lo}-${adjusted.hi} -> 0-255)`);
    return;
  } catch (err) {
    console.log(`preview:   copied as-is (${err.message})`);
  }
  fs.copyFileSync(src, dest);
}

/* ---------------- github plumbing ---------------- */

function originRepo() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!m) fail(`origin is not a GitHub remote: ${url}`);
  return m[1];
}

// The same credential git push uses; GITHUB_TOKEN overrides it.
function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const out = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const token = out.stdout?.match(/^password=(.+)$/m)?.[1];
  if (!token) fail('No GitHub token found — set GITHUB_TOKEN or sign in with git first.');
  return token;
}

async function gh(url, init = {}) {
  const res = await fetch(url.startsWith('https://') ? url : `https://api.github.com${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${githubToken()}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'sanctuarydb-addmap',
      ...init.headers,
    },
  });
  if (!res.ok && res.status !== 404) fail(`GitHub API ${res.status} for ${url}: ${await res.text()}`);
  return res;
}

async function publishAsset(repo, tag, mapName, file, name) {
  let res = await gh(`/repos/${repo}/releases/tags/${tag}`);
  let release;
  if (res.status === 404) {
    res = await gh(`/repos/${repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag,
        name: `Map: ${mapName}`,
        body:
          `Community map **${mapName}** for Sanctuary: Shattered Sun. ` +
          `Download the zip below and extract it into the game's Maps folder.`,
      }),
    });
    release = await res.json();
  } else {
    release = await res.json();
    const stale = release.assets.find((a) => a.name === name);
    if (stale) await gh(`/repos/${repo}/releases/assets/${stale.id}`, { method: 'DELETE' });
  }

  const upload = await gh(
    `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip', 'Content-Length': String(sizeBytes) },
      body: fs.readFileSync(file),
    },
  );
  if (upload.status === 404) fail('Asset upload returned 404 — token may lack release permissions.');
}

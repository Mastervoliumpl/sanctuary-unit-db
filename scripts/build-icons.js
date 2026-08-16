// Recolours the extracted strategic icons into per-faction variants.
//
// The game's icons are two-tone masks: magenta marks the region it tints with
// the player's colour at runtime, black is the glyph and outline drawn on top.
// Shipping them as-is would put magenta squares on the page, so this bakes a
// copy per faction using the same palette the SVG fallback uses.
//
//   icons-src/<shape>_<tech>_<symbol>.png   ->  public/icons/<faction>/<same>.png
//
// Run with `npm run icons` after re-extracting. Zero dependencies: PNG decode
// and encode are done here against node:zlib.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { FACTION_COLOURS } from '../public/icons.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'icons-src');
const OUT = path.join(here, '..', 'public', 'icons');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`No icon masters at ${SRC}. See README "Icons" for the extraction step.`);
  }
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.png'));
  if (!files.length) throw new Error(`No .png files in ${SRC}`);

  const factions = Object.entries(FACTION_COLOURS).filter(([name]) => name !== 'Unknown');

  for (const [name] of factions) {
    fs.mkdirSync(path.join(OUT, slug(name)), { recursive: true });
  }

  let written = 0;
  let untinted = 0;

  for (const file of files) {
    const image = decodePng(fs.readFileSync(path.join(SRC, file)));

    for (const [name, hex] of factions) {
      const tinted = tint(image, hexToRgb(hex));
      if (!tinted.replaced) untinted++;
      fs.writeFileSync(path.join(OUT, slug(name), file), encodePng(tinted.image));
      written++;
    }
  }

  // The site reads this to decide, per unit, whether real artwork exists or it
  // should fall back to the generated SVG.
  const manifest = files.map((f) => path.basename(f, '.png')).sort();
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));

  writePreviewManifest();

  const bytes = factions.reduce(
    (sum, [name]) =>
      sum +
      fs
        .readdirSync(path.join(OUT, slug(name)))
        .reduce((n, f) => n + fs.statSync(path.join(OUT, slug(name), f)).size, 0),
    0
  );

  console.log(`masters:   ${files.length} in icons-src/`);
  console.log(`factions:  ${factions.map(([n]) => n).join(', ')}`);
  console.log(`written:   ${written} icons (${(bytes / 1024).toFixed(0)} KB total)`);
  // A master with no tintable pixels would come out identical for every faction,
  // which almost certainly means the source icon isn't the mask we expect.
  if (untinted) console.warn(`warning:   ${untinted} outputs had no tintable pixels`);
}

// Unit previews need no processing — they're rendered thumbnails with colours
// already baked in — so they sit in public/ directly. All this does is index
// them, since 57 units (all disabled content) have no preview.
function writePreviewManifest() {
  const dir = path.join(here, '..', 'public', 'previews');
  if (!fs.existsSync(dir)) {
    console.warn('warning:   no public/previews directory; unit previews will be skipped');
    return;
  }
  // A few units ship a fully transparent placeholder instead of a render.
  // Indexing those would give the detail panel an empty glowing box, so they're
  // treated as missing and fall through to no preview at all.
  const ids = [];
  let blank = 0;

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
    const id = path.basename(file, '.png');
    let hasPixels = true;
    try {
      const { pixels } = decodePng(fs.readFileSync(path.join(dir, file)));
      hasPixels = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 0) { hasPixels = true; break; }
      }
    } catch {
      // Unreadable here doesn't mean unusable in a browser — keep it.
    }
    hasPixels ? ids.push(id) : blank++;
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(ids));
  console.log(`previews:  ${ids.length} indexed${blank ? ` (${blank} blank placeholders skipped)` : ''}`);
}

const slug = (name) => name.toLowerCase();

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Magenta is the tint mask. Match it tolerantly rather than on an exact
// 255,0,255 so any antialiased edge pixels recolour with the rest.
const isTintable = (r, g, b) => r > 150 && b > 150 && g < 100;

function tint({ width, height, pixels }, [tr, tg, tb]) {
  const out = Buffer.from(pixels);
  let replaced = 0;

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    if (isTintable(out[i], out[i + 1], out[i + 2])) {
      out[i] = tr;
      out[i + 1] = tg;
      out[i + 2] = tb;
      replaced++;
    }
  }
  return { image: { width, height, pixels: out }, replaced };
}

/* ---------------- PNG decode ---------------- */

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colourType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!header) throw new Error('missing IHDR');
  // The extracted icons are all 8-bit RGBA, non-interlaced. Rather than write a
  // general decoder, fail loudly if that ever stops being true.
  if (header.depth !== 8 || header.colourType !== 6 || header.interlace !== 0) {
    throw new Error(
      `unsupported PNG (depth ${header.depth}, colour type ${header.colourType}, interlace ${header.interlace})`
    );
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { width: header.width, height: header.height, pixels: unfilter(raw, header.width, header.height) };
}

function unfilter(raw, width, height) {
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let value = line[x];

      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`bad filter type ${filter} on row ${y}`);

      cur[x] = value & 255;
    }
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* ---------------- PNG encode ---------------- */

function encodePng({ width, height, pixels }) {
  const bpp = 4;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);

  // Pick per row between None and Up filtering — these icons are flat colour,
  // so Up collapses most rows to zeros and deflate does the rest.
  for (let y = 0; y < height; y++) {
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    const dest = raw.subarray(y * (stride + 1), (y + 1) * (stride + 1));

    let noneScore = 0;
    let upScore = 0;
    for (let x = 0; x < stride; x++) {
      noneScore += Math.abs(cur[x] << 24 >> 24);
      upScore += Math.abs(((cur[x] - (prev ? prev[x] : 0)) & 255) << 24 >> 24);
    }

    if (prev && upScore < noneScore) {
      dest[0] = 2;
      for (let x = 0; x < stride; x++) dest[x + 1] = (cur[x] - prev[x]) & 255;
    } else {
      dest[0] = 0;
      cur.copy(dest, 1);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return c ^ -1;
}

main();

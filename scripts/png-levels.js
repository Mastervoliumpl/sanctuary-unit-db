// A minimal 8-bit PNG reader/writer with an auto-levels pass, used by
// add-map.js on map previews.
//
// Converted maps carry previews that are real terrain but badly underexposed —
// a 512px card of one reads as an empty dark rectangle. Rather than take an
// image dependency (this repo has none), decode the one PNG flavour the game
// and the converter actually write (8-bit RGB/RGBA, non-interlaced) and
// stretch its levels. Previews that already use their range are passed through
// untouched, so a good preview is never "corrected" into something garish.

import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Decode to flat 8-bit samples. Throws on anything but the simple case. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  const idat = [];
  let header = null;
  for (let p = 8; p + 8 <= buf.length;) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!header) throw new Error('no IHDR');
  if (header.depth !== 8) throw new Error(`unsupported bit depth ${header.depth}`);
  if (header.interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw new Error(`unsupported colour type ${header.colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);

  // Undo the per-scanline filters (PNG spec §9).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= channels ? prior[i - channels] : 0;
      let value = src[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`unknown filter ${filter}`);
      row[i] = value & 0xff;
    }
  }

  return { width, height, channels, colorType: header.colorType, pixels };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function encodePng({ width, height, channels, colorType, pixels }) {
  const stride = width * channels;
  // Filter 1 (Sub) costs nothing to compute and compresses terrain far better
  // than storing raw scanlines, which is what these files arrive as.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 1;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const dst = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) dst[i] = (row[i] - (i >= channels ? row[i - channels] : 0)) & 0xff;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])));
  return Buffer.concat([head, body, crc]);
}

/**
 * Stretch the image so its colour range fills 0–255. Percentile ends rather
 * than absolute min/max, so a handful of stray dark or blown pixels can't
 * defeat the stretch. Returns null when the image already spans enough of the
 * range to leave alone.
 */
export function autoLevels(img, { minSpan = 200, clip = 0.002 } = {}) {
  const { pixels, channels } = img;
  const colour = channels >= 3;
  const histogram = new Uint32Array(256);
  let count = 0;

  for (let i = 0; i < pixels.length; i += channels) {
    const luma = colour
      ? Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2])
      : pixels[i];
    histogram[luma]++;
    count++;
  }

  const cut = Math.floor(count * clip);
  let lo = 0;
  let hi = 255;
  for (let acc = 0, v = 0; v < 256; v++)
    if ((acc += histogram[v]) > cut) {
      lo = v;
      break;
    }
  for (let acc = 0, v = 255; v >= 0; v--)
    if ((acc += histogram[v]) > cut) {
      hi = v;
      break;
    }

  const span = hi - lo;
  if (span <= 0 || span >= minSpan) return null;

  const gain = 255 / span;
  const map = new Uint8Array(256);
  for (let v = 0; v < 256; v++) map[v] = Math.min(255, Math.max(0, Math.round((v - lo) * gain)));

  // Alpha is a mask, not a tone — leave it alone.
  const opaque = channels === 3 || channels === 1 ? channels : channels - 1;
  for (let i = 0; i < pixels.length; i += channels) {
    for (let c = 0; c < opaque; c++) pixels[i + c] = map[pixels[i + c]];
  }

  return { lo, hi };
}

// Unit icons: the game's own artwork where it was extracted, and a generated
// SVG in the same visual language where it wasn't. The game composes its icons
// from the same shape / symbol / tech triple every template carries, so the
// fallback stays in sync with the data instead of needing a separate art
// pipeline.
//
// Canvas is a 64x64 box: outline shape at the edge, role glyph in the upper
// middle, tech-tier pips along the bottom.

import type { Faction, UnitIconSpec } from '../lib/types';

// Faction liveries, matching the in-game unit schemes.
export const FACTION_COLOURS: Record<string, string> = {
  EDA: '#4ad17e',
  Chosen: '#ff5a52',
  Guard: '#f5b52a',
  Unknown: '#8b95a5',
};

// Column order everywhere in the UI.
export const FACTION_ORDER: Faction[] = ['EDA', 'Chosen', 'Guard'];

// Outline silhouettes. The "2" variants repeat the same outline inset, which is
// how the game distinguishes the heavier chassis of the same movement class.
const SHAPES: Record<string, string> = {
  land1: 'M8 8 H56 V56 H8 Z',
  land2: 'M8 8 H56 V56 H8 Z',
  bot1: 'M16 8 H48 A8 8 0 0 1 56 16 V48 A8 8 0 0 1 48 56 H16 A8 8 0 0 1 8 48 V16 A8 8 0 0 1 16 8 Z',
  bot2: 'M16 8 H48 A8 8 0 0 1 56 16 V48 A8 8 0 0 1 48 56 H16 A8 8 0 0 1 8 48 V16 A8 8 0 0 1 16 8 Z',
  air1: 'M8 24 L22 8 H42 L56 24 V56 H8 Z',
  air2: 'M8 24 L22 8 H42 L56 24 V56 H8 Z',
  naval1: 'M8 8 H56 V40 L32 58 L8 40 Z',
  naval2: 'M8 8 H56 V40 L32 58 L8 40 Z',
  structure1: 'M20 8 H44 L56 20 V44 L44 56 H20 L8 44 V20 Z',
  structure2: 'M20 8 H44 L56 20 V44 L44 56 H20 L8 44 V20 Z',
  experimental1: 'M32 6 A26 26 0 1 1 31.99 6 Z',
  experimental2: 'M32 6 A26 26 0 1 1 31.99 6 Z',
};

const DOUBLE_OUTLINE = new Set(['land2', 'bot2', 'air2', 'naval2', 'structure2', 'experimental2']);

// Role glyphs, drawn inside a box centred on (32, 27) roughly 26px across.
// Static markup, injected with dangerouslySetInnerHTML — nothing user-supplied.
const SYMBOLS: Record<string, string> = {
  // Direct fire: solid core.
  direct: '<circle cx="32" cy="27" r="8" fill="currentColor"/>',

  // Artillery: lobbed arc with the shell at its apex.
  indirect:
    '<path d="M20 37 Q32 11 44 37" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>' +
    '<circle cx="32" cy="18" r="3" fill="currentColor"/>',

  // Anti-air: stacked chevrons pointing up.
  aa:
    '<path d="M21 30 L32 18 L43 30" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M21 39 L32 27 L43 39" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',

  // Anti-naval: chevrons pointing down, mirroring the AA glyph.
  antiNaval:
    '<path d="M21 20 L32 32 L43 20" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M21 29 L32 41 L43 29" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',

  // Engineer: build cross.
  engineer:
    '<path d="M32 15 V39 M20 27 H44" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',

  // Intel: radar sweep arcs.
  intel:
    '<circle cx="32" cy="34" r="3" fill="currentColor"/>' +
    '<path d="M23 32 A10 10 0 0 1 41 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M17 28 A17 17 0 0 1 47 28" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',

  // Shield: bubble over a baseline.
  shield:
    '<path d="M32 15 L44 20 V29 Q44 39 32 43 Q20 39 20 29 V20 Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>',

  // Plasma / heavy energy: four-point star.
  plasma:
    '<path d="M32 14 L36 24 L46 27 L36 30 L32 40 L28 30 L18 27 L28 24 Z" fill="currentColor"/>',

  // Alloy / economy: hex resource cell.
  alloy:
    '<path d="M32 15 L43 21 V33 L32 39 L21 33 V21 Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>',

  // Factory output markers — what the structure produces.
  air: '<path d="M32 15 L44 39 L32 33 L20 39 Z" fill="currentColor"/>',
  land: '<rect x="21" y="18" width="22" height="18" rx="2" fill="currentColor"/>',
  naval:
    '<path d="M19 24 H45 L39 36 H25 Z" fill="currentColor"/>' +
    '<path d="M18 41 Q25 37 32 41 Q39 45 46 41" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',

  // Transmitter: mast with broadcast arcs.
  transmiter:
    '<path d="M32 18 V40" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>' +
    '<path d="M24 20 A12 12 0 0 0 24 38" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M40 20 A12 12 0 0 1 40 38" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',

  none: '',
};

const comboKey = (icon: UnitIconSpec | null): string | null =>
  icon?.shape && icon?.tech && icon?.symbol ? `${icon.shape}_${icon.tech}_${icon.symbol}` : null;

interface UnitIconProps {
  icon: UnitIconSpec | null;
  faction: string;
  /** Combos with real extracted artwork; comes from loadData(). */
  manifest: Set<string>;
  size?: number;
  muted?: boolean;
}

export function UnitIcon({ icon, faction, manifest, size = 40, muted = false }: UnitIconProps) {
  const key = comboKey(icon);
  if (key && manifest.has(key)) {
    const dir = (FACTION_COLOURS[faction] ? faction : 'EDA').toLowerCase();
    return (
      <img
        className="unit-icon"
        src={`/icons/${dir}/${key}.png`}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        decoding="async"
        data-muted={muted || undefined}
      />
    );
  }
  return <UnitIconSvg icon={icon} faction={faction} size={size} muted={muted} />;
}

/** The generated fallback, also used directly for combos the game never shipped. */
export function UnitIconSvg({
  icon,
  faction,
  size = 40,
  muted = false,
}: Omit<UnitIconProps, 'manifest'>) {
  const colour = muted ? 'var(--icon-muted)' : (FACTION_COLOURS[faction] ?? FACTION_COLOURS.Unknown);
  const shape = icon?.shape ?? 'land1';
  const shapePath = SHAPES[shape] ?? SHAPES.land1;
  const glyph = SYMBOLS[icon?.symbol ?? 'none'] ?? '';
  const tier = Number(String(icon?.tech ?? '').replace('t', '')) || 0;

  return (
    <svg
      className="unit-icon"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-hidden="true"
      style={{ color: colour }}
    >
      <path d={shapePath} fill="var(--icon-fill)" stroke={colour} strokeWidth={3.5} strokeLinejoin="round" />
      {DOUBLE_OUTLINE.has(shape) && (
        <g transform="translate(32 32) scale(0.78) translate(-32 -32)">
          <path d={shapePath} fill="none" stroke={colour} strokeWidth={3.2} opacity={0.75} />
        </g>
      )}
      <g dangerouslySetInnerHTML={{ __html: glyph }} />
      <TierPips tier={tier} colour={colour} />
    </svg>
  );
}

// Tier is shown as pips along the bottom edge; tier 4 gets a solid bar since
// four separate pips read as noise at small sizes.
function TierPips({ tier, colour }: { tier: number; colour: string }) {
  if (tier <= 0) return null;
  if (tier >= 4) return <rect x={21} y={46} width={22} height={4} rx={2} fill={colour} />;

  const gap = 8;
  const start = 32 - ((tier - 1) * gap) / 2;
  return (
    <>
      {Array.from({ length: tier }, (_, i) => (
        <rect key={i} x={start + i * gap - 2.5} y={46} width={5} height={4} rx={1.5} fill={colour} />
      ))}
    </>
  );
}

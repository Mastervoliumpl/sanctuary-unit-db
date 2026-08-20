import type { Unit, Weapon } from '../lib/types';
import { fmt, shortName } from '../lib/format';
import { FACTION_COLOURS, UnitIcon } from './UnitIcon';

interface UnitCardProps {
  unit: Unit;
  iconManifest: Set<string>;
  onOpen: (id: string) => void;
}

export function UnitCard({ unit: u, iconManifest, onOpen }: UnitCardProps) {
  // Only no-model units get dimmed — an in-progress unit has real art and real
  // numbers, it just isn't switched on, so it keeps its colour and says why.
  const muted = u.status === 'no-model';
  return (
    <button
      type="button"
      className={`card ${muted ? 'unplayable' : ''}`}
      style={{ '--fc': FACTION_COLOURS[u.faction] } as React.CSSProperties}
      onClick={() => onOpen(u.id)}
    >
      <UnitIcon icon={u.icon} faction={u.faction} manifest={iconManifest} size={32} muted={muted} />
      <span className="who">
        <h4>
          {u.name ?? shortName(u)}
          {u.status === 'in-progress' && (
            <span className="wip" title={u.statusReason ?? 'Not enabled'}>
              WIP
            </span>
          )}
        </h4>
        <small>{u.displayName}</small>
        <span className="stat-row">
          <span className="alloy-val">
            {fmt(u.cost.alloys)}
            <i>a</i>
          </span>
          <span className="energy-val">
            {fmt(u.cost.energy)}
            <i>e</i>
          </span>
          <span className="dim">
            {fmt(u.health)}
            <i>hp</i>
          </span>
          {u.dps ? (
            <span className="dim">
              {fmt(u.dps)}
              <i>dps</i>
            </span>
          ) : null}
        </span>
        <WeaponLines unit={u} />
      </span>
    </button>
  );
}

// One line per distinct weapon. Grouping means even the heaviest units top out
// at four, so every weapon fits without the card running away.
function WeaponLines({ unit: u }: { unit: Unit }) {
  if (!u.weapons.length) return null;

  return (
    <span className="wlines">
      {u.weapons.map((w, i) => {
        const bits = [
          w.damage > 0 ? `${fmt(w.damage)} dmg` : 'impact',
          `${w.rangeMax} rng`,
          w.isBeam
            ? beamLabel(w).replace(' beam', '')
            : w.projectileSpeed
              ? `${fmt(w.projectileSpeed)} spd`
              : null,
        ].filter(Boolean);

        return (
          <span className="wline" key={i}>
            {w.count > 1 ? <b>×{w.count}</b> : null}
            {bits.join(' · ')}
          </span>
        );
      })}
    </span>
  );
}

// Continuous beams damage every tick while held on target; pulse beams land a
// single tick per reload; burst beams land beamLifetime ticks per reload.
export function beamLabel(w: Weapon): string {
  if (w.beamMode === 'continuous') return 'continuous beam';
  if (w.beamMode === 'burst') return `${w.beamLifetime}-tick beam`;
  return 'pulse beam';
}

import type { ReactNode } from 'react';
import type { Unit, Weapon } from '../lib/types';
import type { LoadedData } from '../lib/data';
import { STATUS_LABELS } from '../lib/board';
import { builderName, fmt, shortName, splitCamel } from '../lib/format';
import { FACTION_COLOURS, UnitIcon } from './UnitIcon';
import { beamLabel } from './UnitCard';

interface DetailPanelProps {
  unit: Unit;
  loaded: LoadedData;
  onOpen: (id: string) => void;
  onClose: () => void;
}

export function DetailPanel({ unit: u, loaded, onOpen, onClose }: DetailPanelProps) {
  const { byId, iconManifest, previews } = loaded;

  return (
    <>
      <aside className="detail" aria-live="polite">
        <div className="detail-head">
          <UnitIcon icon={u.icon} faction={u.faction} manifest={iconManifest} size={52} muted={u.status === 'no-model'} />
          <div>
            <h2>{u.name ?? shortName(u)}</h2>
            <div className="sub2">
              {u.displayName} · <code>{u.id}</code>
            </div>
          </div>
          <button type="button" className="detail-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {/* The game's own render, upscaled from 64px — soft, but it's the only
            size shipped and it reads far better than an icon at this size. */}
        {previews.has(u.id) && (
          <div className="preview" style={{ '--fc': FACTION_COLOURS[u.faction] } as React.CSSProperties}>
            <img src={`/previews/${u.id}.png`} alt={u.name ?? u.displayName} width={132} height={132} decoding="async" />
          </div>
        )}

        <div className="badges">
          <span
            className="badge"
            style={{ color: FACTION_COLOURS[u.faction], borderColor: `${FACTION_COLOURS[u.faction]}66` }}
          >
            {u.faction}
          </span>
          {u.tier ? <span className="badge">Tier {u.tier}</span> : null}
          <span className="badge">{u.domain}</span>
          {u.role ? <span className="badge">{u.role}</span> : null}
          {u.status !== 'in-game' && (
            <span className="badge warn">
              {STATUS_LABELS[u.status]}
              {u.statusReason ? ` — ${u.statusReason}` : ''}
            </span>
          )}
        </div>

        <Section title="Cost & core">
          <dl className="statgrid">
            <Stat label="Alloys" value={<span className="alloy-val">{fmt(u.cost.alloys)}</span>} />
            <Stat label="Energy" value={<span className="energy-val">{fmt(u.cost.energy)}</span>} />
            <Stat label="Build time" value={fmt(u.buildTime)} />
            <Stat label="Health" value={fmt(u.health)} />
            {u.dps ? <Stat label="DPS" value={fmt(u.dps)} /> : null}
            {u.maxRange ? <Stat label="Range" value={u.maxRange} /> : null}
            {u.projectileSpeed ? <Stat label="Proj. speed" value={fmt(u.projectileSpeed)} /> : null}
          </dl>
        </Section>

        <EconomySection unit={u} />
        <AdjacencySection unit={u} />
        <WeaponsSection unit={u} />
        <ShieldSection unit={u} />
        <MobilitySection unit={u} />
        <BuildSection unit={u} byId={byId} iconManifest={iconManifest} onOpen={onOpen} />

        <Section title="Tags">
          <div className="unit-links">
            {u.tags.map((t) => (
              <span className="badge" key={t}>
                {t}
              </span>
            ))}
          </div>
        </Section>
      </aside>
      <div className="scrim" onClick={onClose} />
    </>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="section">
    <h3>{title}</h3>
    {children}
  </div>
);

const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

const rates = (obj: Record<string, number | undefined>) =>
  Object.entries(obj)
    .map(([k, v]) => `${v}/s ${k}`)
    .join(', ');

function EconomySection({ unit: u }: { unit: Unit }) {
  const lines: Array<[string, string | number]> = [];
  if (u.production) lines.push(['Produces', rates(u.production as Record<string, number>)]);
  if (u.upkeep) lines.push(['Upkeep', rates(u.upkeep as Record<string, number>)]);
  if (u.storage)
    lines.push([
      'Storage',
      Object.entries(u.storage)
        .map(([k, v]) => `${fmt(v)} ${k}`)
        .join(', '),
    ]);
  if (u.buildPower) lines.push(['Build power', u.buildPower]);
  if (!lines.length) return null;

  return (
    <Section title="Economy">
      <dl className="kv">
        {lines.map(([k, v]) => (
          <KV key={k} k={k} v={v} />
        ))}
      </dl>
    </Section>
  );
}

const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <>
    <dt>{k}</dt>
    <dd>{v}</dd>
  </>
);

// Structures pass bonuses to whatever is built touching them. Only the granting
// side is in the templates, so this is shown on the generator/extractor rather
// than on the factory that benefits.
function AdjacencySection({ unit: u }: { unit: Unit }) {
  if (!u.adjacency?.effects?.length) return null;

  return (
    <Section title="Adjacency bonus">
      <dl className="kv">
        {u.adjacency.effects.map((e, i) => (
          <KV
            key={i}
            k={e.label}
            v={
              <>
                <strong className="good">
                  {e.percent < 0 ? '' : '+'}
                  {e.percent}%
                </strong>{' '}
                {e.resource} · to adjacent {e.targets.map((t) => t.replace(/_/g, ' ').toLowerCase()).join(' or ')}
              </>
            }
          />
        ))}
      </dl>
      <p className="hint">Applies to structures built directly against this one, and stacks per adjacent source.</p>
    </Section>
  );
}

function WeaponsSection({ unit: u }: { unit: Unit }) {
  const death = u.deathExplosion ? (
    <dl className="kv" style={{ marginTop: 8 }}>
      <KV
        k="Death explosion"
        v={`${fmt(u.deathExplosion.damage)} dmg${u.deathExplosion.radius ? ` · ${u.deathExplosion.radius} radius` : ''}`}
      />
    </dl>
  ) : null;

  if (!u.weapons.length) return death ? <Section title="Weapons">{death}</Section> : null;

  return (
    <Section title="Weapons">
      {u.weapons.map((w, i) => (
        <WeaponBlock weapon={w} key={i} />
      ))}
      {death}
    </Section>
  );
}

function WeaponBlock({ weapon: w }: { weapon: Weapon }) {
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

  return (
    <div className="weapon">
      <div className="weapon-top">
        {w.count > 1 ? <span className="wcount">×{w.count}</span> : null}
        <strong>{weaponLabel(w)}</strong>
        {w.dpsTotal != null ? (
          <span className="wdps">{fmt(w.dpsTotal)} dps</span>
        ) : (
          <span className="wdps" title="The template declares no muzzle bones, so the game scores this weapon zero">
            dps unknown
          </span>
        )}
      </div>
      <div className="weapon-facts">{facts.join(' · ')}</div>
      <div className="weapon-facts aim">{aim.join(' · ')}</div>
      {w.targets.length ? <div className="weapon-targets">Hits {w.targets.join(', ')}</div> : null}
    </div>
  );
}

// Damage of 0 with a collider-based category means the damage lives on the
// projectile, not the weapon — say so rather than printing a bare "0 dmg".
function weaponLabel(w: Weapon): string {
  const kind = w.isBeam ? 'Beam' : w.category ? splitCamel(w.category) : null;
  if (w.damage <= 0) return `${kind ?? 'Weapon'} · damage on impact`;
  return kind ? `${fmt(w.damage)} dmg · ${kind}` : `${fmt(w.damage)} dmg`;
}

function ShieldSection({ unit: u }: { unit: Unit }) {
  if (!u.shields.length) return null;
  return (
    <Section title="Shields">
      {u.shields.map((s, i) => (
        <dl className="kv" key={i}>
          <KV k={s.name} v={`${fmt(s.max)} hp`} />
          {s.radius ? <KV k="Radius" v={s.radius} /> : null}
          {s.regen ? <KV k="Regen" v={`${s.regen}/s after ${s.regenDelay ?? 0}s`} /> : null}
        </dl>
      ))}
    </Section>
  );
}

function MobilitySection({ unit: u }: { unit: Unit }) {
  const lines: Array<[string, ReactNode]> = [];
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
  if (!lines.length) return null;

  return (
    <Section title="Mobility & intel">
      <dl className="kv">
        {lines.map(([k, v]) => (
          <KV key={k} k={k} v={v} />
        ))}
      </dl>
    </Section>
  );
}

function BuildSection({
  unit: u,
  byId,
  iconManifest,
  onOpen,
}: {
  unit: Unit;
  byId: Map<string, Unit>;
  iconManifest: Set<string>;
  onOpen: (id: string) => void;
}) {
  const chips = (ids: string[]) => (
    <div className="unit-links">
      {ids.map((id) => {
        const t = byId.get(id);
        if (!t) return null;
        return (
          <button type="button" className="unit-link" key={id} onClick={() => onOpen(id)}>
            <UnitIcon icon={t.icon} faction={t.faction} manifest={iconManifest} size={20} muted={t.status === 'no-model'} />
            {builderName(t)}
          </button>
        );
      })}
    </div>
  );

  // buildTime is in build-power-seconds, so the wall-clock time depends on
  // whichever builder is making it.
  const times = u.builtBy
    .map((id) => byId.get(id))
    .filter((b): b is Unit => Boolean(b?.buildPower))
    .map((b) => [builderName(b), `${(u.buildTime / b.buildPower!).toFixed(1)}s`] as const);

  if (!u.builtBy.length && !u.builds.length && !u.upgradesTo) return null;

  return (
    <div className="section">
      {u.builtBy.length > 0 && (
        <>
          <h3>Built by</h3>
          {chips(u.builtBy)}
          {times.length > 0 && (
            <dl className="kv" style={{ marginTop: 8 }}>
              {times.map(([k, v]) => (
                <KV key={k} k={k} v={v} />
              ))}
            </dl>
          )}
        </>
      )}
      {u.builds.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Can build</h3>
          {chips(u.builds)}
        </>
      )}
      {u.upgradesTo && (
        <>
          <h3 style={{ marginTop: 16 }}>Upgrades to</h3>
          {chips([u.upgradesTo])}
        </>
      )}
    </div>
  );
}

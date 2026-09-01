// Rating-over-time as a hand-rolled inline SVG polyline — one series, no
// axes ceremony, no chart library. The x-axis is game number, which is the
// honest axis for a ladder where people play in bursts.

import { START_RATING } from '../lib/elo';

const W = 560;
const H = 160;
const PAD = 8;

export function RatingGraph({ ratings }: { ratings: number[] }) {
  if (ratings.length === 0) return null;
  const series = [START_RATING, ...ratings];

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(max - min, 40); // keep a flat series from filling the frame
  const mid = (min + max) / 2;
  const lo = mid - span / 2;

  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(series.length - 1, 1);
  const y = (r: number) => H - PAD - ((r - lo) * (H - 2 * PAD)) / span;
  const points = series.map((r, i) => `${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];

  return (
    <svg
      className="rating-graph"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Rating history, currently ${last}`}
    >
      <line x1={PAD} y1={y(START_RATING)} x2={W - PAD} y2={y(START_RATING)} className="rg-base" />
      <polyline points={points} className="rg-line" />
      <circle cx={x(series.length - 1)} cy={y(last)} r={3} className="rg-dot" />
      <text x={W - PAD} y={y(last) - 6} textAnchor="end" className="rg-label">
        {last}
      </text>
    </svg>
  );
}

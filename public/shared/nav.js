// Shared site chrome. Every page calls mountHeader() with its own subtitle, so
// the nav lives in one place rather than being copy-pasted per page.
//
// Assets are referenced from the site root (/data, /icons, ...) rather than
// relatively, because pages sit at different depths — / and /calculator/ — and
// relative paths would resolve differently on each.

const PAGES = [
  { href: '/', label: 'Units', match: (p) => p === '/' || p.startsWith('/index') },
  { href: '/calculator/', label: 'Calculator', match: (p) => p.startsWith('/calculator') },
];

export function mountHeader({ subtitle = '' } = {}) {
  const path = location.pathname;
  const links = PAGES.map(
    (page) =>
      `<a href="${page.href}" class="navlink${page.match(path) ? ' active' : ''}">${page.label}</a>`
  ).join('');

  document.querySelector('#site-header').innerHTML = `
    <div class="brand">
      <a href="/" class="wordmark">Sanctuary<span>DB</span></a>
      <p class="sub" id="meta-line">${subtitle}</p>
    </div>
    <nav class="nav">${links}</nav>
    <div class="header-slot" id="header-slot"></div>`;

  trackHeaderHeight();
}

/** Shared loader so both pages read the same file and fail the same way. */
export async function loadUnits() {
  const res = await fetch('/data/units.json');
  if (!res.ok) throw new Error(`units.json returned ${res.status}`);
  return res.json();
}

export const setMetaLine = (text) => {
  const el = document.querySelector('#meta-line');
  if (el) el.textContent = text;
};

/** Seconds as a compact human duration — build times run from 1s to hours. */
export function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export const fmt = (n, digits = 2) =>
  n == null || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('en-GB', { maximumFractionDigits: digits });

// Sticky sidebars and column headers sit below the bar, whose height depends on
// the viewport (it wraps when narrow), so publish the measured height rather
// than hard-coding an offset that silently drifts when the chrome changes.
function trackHeaderHeight() {
  const header = document.querySelector('#site-header');
  if (!header) return;

  const publish = () =>
    document.documentElement.style.setProperty(
      '--header-h',
      `${Math.round(header.getBoundingClientRect().height)}px`
    );

  publish();
  new ResizeObserver(publish).observe(header);
}

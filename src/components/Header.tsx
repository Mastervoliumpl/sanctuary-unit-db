// Shared site chrome, rendered once by the root route: one dense 46px bar with
// the brand, nav and a centred slot (the units page portals its search here).

import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { AuthChip } from './AuthChip';

export function Header() {
  const ref = useRef<HTMLElement>(null);

  // Sticky sidebars and column headers sit below the bar, whose height depends
  // on the viewport (it wraps when narrow), so publish the measured height
  // rather than hard-coding an offset that silently drifts when the chrome
  // changes.
  useEffect(() => {
    const header = ref.current;
    if (!header) return;

    const publish = () =>
      document.documentElement.style.setProperty(
        '--header-h',
        `${Math.round(header.getBoundingClientRect().height)}px`,
      );

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="topbar" ref={ref}>
      <Link to="/" className="brand">
        <svg viewBox="0 0 64 64" width={18} height={18} aria-hidden="true">
          <path d="M20 8H44L56 20V44L44 56H20L8 44V20Z" fill="none" stroke="var(--accent)" strokeWidth={6} />
        </svg>
        <span className="wordmark">
          Sanctuary<span>DB</span>
        </span>
      </Link>
      <span className="topbar-divider" aria-hidden="true" />
      <nav className="nav">
        <Link
          to="/"
          className="navlink"
          activeOptions={{ exact: true, includeSearch: false }}
          activeProps={{ className: 'navlink active' }}
        >
          Units
        </Link>
        <Link
          to="/calculator"
          className="navlink"
          activeOptions={{ includeSearch: false }}
          activeProps={{ className: 'navlink active' }}
        >
          Calculator
        </Link>
        <Link
          to="/maps"
          className="navlink"
          activeOptions={{ includeSearch: false }}
          activeProps={{ className: 'navlink active' }}
        >
          Maps
        </Link>
        <Link
          to="/modding"
          className="navlink"
          activeOptions={{ includeSearch: false }}
          activeProps={{ className: 'navlink active' }}
        >
          Modding
        </Link>
        <Link
          to="/play"
          className="navlink"
          activeOptions={{ includeSearch: false }}
          activeProps={{ className: 'navlink active' }}
        >
          Play
        </Link>
        <Link
          to="/ladder"
          className="navlink"
          activeOptions={{ includeSearch: false }}
          activeProps={{ className: 'navlink active' }}
        >
          Ladder
        </Link>
      </nav>
      <div className="header-slot" />
      <AuthChip />
    </header>
  );
}

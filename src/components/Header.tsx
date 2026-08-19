// Shared site chrome, rendered once by the root route. Pages own the subtitle
// via setMetaLine().

import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { useMetaLine } from '../lib/meta-line';

export function Header() {
  const ref = useRef<HTMLElement>(null);
  const metaLine = useMetaLine();

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
        `${Math.round(header.getBoundingClientRect().height)}px`
      );

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="topbar" ref={ref}>
      <div className="brand">
        <Link to="/" className="wordmark">
          Sanctuary<span>DB</span>
        </Link>
        <p className="sub">{metaLine}</p>
      </div>
      <nav className="nav">
        <Link to="/" className="navlink" activeOptions={{ exact: true, includeSearch: false }} activeProps={{ className: 'navlink active' }}>
          Units
        </Link>
        <Link to="/calculator" className="navlink" activeOptions={{ includeSearch: false }} activeProps={{ className: 'navlink active' }}>
          Calculator
        </Link>
      </nav>
      <div className="header-slot" />
    </header>
  );
}

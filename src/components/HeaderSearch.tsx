// A search field portalled into the shared header's centre slot.
//
// Search belongs in the one dense bar at the top, but only the pages that have
// something to search render one, so the field is portalled in from the route
// rather than baked into <Header>. The header is part of the SSR'd shell, so
// its slot is already in the DOM by the time a route (all ssr: false) renders
// on the client.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface HeaderSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export function HeaderSearch({ value, onChange, placeholder }: HeaderSearchProps) {
  const [slot] = useState(() => document.querySelector('.header-slot'));

  // "/" focuses the field from anywhere, the shortcut the keycap advertises.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.id !== 'search') {
        e.preventDefault();
        document.getElementById('search')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!slot) return null;
  return createPortal(
    <div className="search">
      <svg viewBox="0 0 16 16" width={13} height={13} aria-hidden="true">
        <circle cx={7} cy={7} r={5} fill="none" stroke="currentColor" strokeWidth={1.6} />
        <line
          x1={11}
          y1={11}
          x2={14.5}
          y2={14.5}
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </svg>
      <input
        type="search"
        id="search"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <kbd title="Press / to search">/</kbd>
    </div>,
    slot,
  );
}

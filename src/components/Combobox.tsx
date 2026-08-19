// A filtering combobox: type to narrow, click or keyboard to pick.
//
// A plain <select> can't be searched, and these lists run to a couple of
// hundred units, so scrolling to find one is painful. This keeps the same shape
// as a select from the caller's point of view — options, value, onPick — but
// filters as you type. The caller owns the value (including fallbacks when the
// option list changes under it).

import { useEffect, useRef, useState } from 'react';
import type { ComboOption } from '../lib/calc';

interface ComboboxProps {
  options: ComboOption[];
  value: string | null;
  onPick: (value: string) => void;
  placeholder?: string;
  empty?: string;
}

export function Combobox({
  options,
  value,
  onPick,
  placeholder = 'Type to search…',
  empty = 'No matches',
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Only meaningful while open; while closed the input *derives* its text from
  // the selection, so outside changes (a new target swapping the builder list)
  // show up without any state syncing.
  const [draft, setDraft] = useState('');
  const mount = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';
  const text = open ? draft : selectedLabel;

  const q = text.trim().toLowerCase();
  // An untouched field shows everything, so opening it behaves like a select.
  const rows =
    !q || q === selectedLabel.toLowerCase() ? options : options.filter((o) => o.search.includes(q));
  const activeIdx = Math.min(active, rows.length - 1);

  useEffect(() => {
    listRef.current?.querySelector('.combo-item.active')?.scrollIntoView({ block: 'nearest' });
  });

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (open && !mount.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  const pick = (next: string) => {
    setOpen(false);
    onPick(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(-1);
        return;
      }
      setActive((activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % Math.max(rows.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = rows[activeIdx] ?? (rows.length === 1 ? rows[0] : null);
      if (chosen) pick(chosen.value);
    } else if (e.key === 'Escape') {
      setOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="combo" ref={mount}>
      <input
        type="text"
        className="combo-input"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        value={text}
        onFocus={(e) => {
          e.target.select();
          setDraft(selectedLabel);
          setOpen(true);
          setActive(-1);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="combo-list" hidden={!open} ref={listRef}>
        {rows.length ? (
          rows.map((o, i) => (
            <button
              type="button"
              key={o.value}
              className={`combo-item${i === activeIdx ? ' active' : ''}${o.value === value ? ' picked' : ''}`}
              // mousedown, not click — blur would close the list before click landed.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
            >
              {o.label}
              {o.hint ? <small>{o.hint}</small> : null}
            </button>
          ))
        ) : (
          <p className="combo-empty">{empty}</p>
        )}
      </div>
    </div>
  );
}

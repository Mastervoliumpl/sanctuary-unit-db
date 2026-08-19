// A filtering combobox: type to narrow, click or keyboard to pick.
//
// A plain <select> can't be searched, and these lists run to a couple of hundred
// units, so scrolling to find one is painful. This keeps the same shape as a
// select from the caller's point of view — give it options and an onPick — but
// filters as you type.

export function combobox(mount, { options, value, placeholder = 'Type to search…', onPick, empty = 'No matches' }) {
  let items = options;
  let open = false;
  let active = -1;

  // Behave like a select: if the caller's value is not in the list — a stale URL,
  // or a builder that cannot make the newly chosen target — fall back to the
  // first valid option rather than sitting empty.
  if (!items.some((o) => o.value === value)) value = items[0]?.value ?? null;

  mount.classList.add('combo');
  mount.innerHTML = `
    <input type="text" class="combo-input" placeholder="${placeholder}"
           autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false">
    <div class="combo-list" hidden></div>`;

  const input = mount.querySelector('.combo-input');
  const list = mount.querySelector('.combo-list');

  const labelFor = (v) => items.find((o) => o.value === v)?.label ?? '';
  const setInputToSelection = () => { input.value = labelFor(value); };

  function visible() {
    const q = input.value.trim().toLowerCase();
    // An untouched field shows everything, so opening it behaves like a select.
    if (!q || q === labelFor(value).toLowerCase()) return items;
    return items.filter((o) => o.search.includes(q));
  }

  function draw() {
    const rows = visible();
    active = Math.min(active, rows.length - 1);

    list.innerHTML = rows.length
      ? rows
          .map(
            (o, i) =>
              `<button type="button" class="combo-item${i === active ? ' active' : ''}${
                o.value === value ? ' picked' : ''
              }" data-value="${o.value}">${o.label}${
                o.hint ? `<small>${o.hint}</small>` : ''
              }</button>`
          )
          .join('')
      : `<p class="combo-empty">${empty}</p>`;

    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    list.querySelector('.combo-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  const show = () => { open = true; active = -1; draw(); };
  const hide = () => { open = false; setInputToSelection(); draw(); };

  function pick(next) {
    value = next;
    setInputToSelection();
    hide();
    onPick?.(next);
  }

  input.addEventListener('focus', () => { input.select(); show(); });
  input.addEventListener('input', () => { open = true; active = 0; draw(); });

  input.addEventListener('keydown', (e) => {
    const rows = visible();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return show();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % Math.max(rows.length, 1);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = rows[active] ?? (rows.length === 1 ? rows[0] : null);
      if (chosen) pick(chosen.value);
    } else if (e.key === 'Escape') {
      hide();
      input.blur();
    }
  });

  list.addEventListener('mousedown', (e) => {
    // mousedown, not click — blur would close the list before click landed.
    const btn = e.target.closest('.combo-item');
    if (btn) { e.preventDefault(); pick(btn.dataset.value); }
  });

  document.addEventListener('click', (e) => { if (open && !mount.contains(e.target)) hide(); });

  setInputToSelection();
  draw();

  return {
    get value() { return value; },
    /** Swap the option list — used when the valid builders change. */
    setOptions(next, keepValue = true) {
      items = next;
      if (!keepValue || !items.some((o) => o.value === value)) value = items[0]?.value ?? null;
      setInputToSelection();
      draw();
      return value;
    },
    setValue(next) { value = next; setInputToSelection(); draw(); },
  };
}

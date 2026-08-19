import { useSyncExternalStore } from 'react';

// The header's subtitle ("283 units · extracted …") is owned by whichever page
// is mounted, but rendered by the shared <Header>. A tiny external store keeps
// that one-way without threading props through the route tree.

let text = '';
const listeners = new Set<() => void>();

export function setMetaLine(next: string): void {
  text = next;
  for (const fn of listeners) fn();
}

export function useMetaLine(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => text,
    () => ''
  );
}

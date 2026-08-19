import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// Every search param on this site is a plain string (comma-joined lists,
// unit ids), so skip the router's default JSON encoding — it would write
// ?tier=%222%22 where the pre-framework site wrote ?tier=2, and shared links
// from that era must keep parsing the same way.
function parseSearch(searchStr: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(searchStr));
}

function stringifySearch(search: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v != null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// The name matters: @tanstack/react-start's generated entries import
// `getRouter` from this file.
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    parseSearch,
    stringifySearch,
  });
}

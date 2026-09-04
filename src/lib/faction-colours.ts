// Faction liveries, matching the in-game unit schemes. Kept in a plain .ts
// module (no JSX, no imports) so scripts/build-icons.js can load it under
// Node's native type stripping as well as the site importing it through Vite.
export const FACTION_COLOURS: Record<string, string> = {
  EDA: '#4ad17e',
  Chosen: '#ff5a52',
  Guard: '#f5b52a',
  Unknown: '#8b95a5',
};

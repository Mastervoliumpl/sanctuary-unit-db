// Finds the game's install directory by reading Steam's library index, so the
// extractor keeps working if the game is moved to a different drive or library.
//
// Override with SANCTUARY_PATH=... when Steam isn't installed in a standard
// location (or when running against a copied-out RuntimeContent tree).

import fs from 'node:fs';
import path from 'node:path';

const GAME_DIRS = ['Sanctuary Shattered Sun Demo', 'Sanctuary Shattered Sun'];

const STEAM_ROOTS = [
  'C:/Program Files (x86)/Steam',
  'C:/Program Files/Steam',
  path.join(process.env.HOME ?? '', '.steam/steam'),
  path.join(process.env.HOME ?? '', 'Library/Application Support/Steam'),
];

export function locateGame() {
  const override = process.env.SANCTUARY_PATH;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`SANCTUARY_PATH points at a missing directory: ${override}`);
    }
    return override;
  }

  for (const library of steamLibraries()) {
    for (const name of GAME_DIRS) {
      const candidate = path.join(library, 'steamapps', 'common', name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  throw new Error(
    'Could not find the game. Set SANCTUARY_PATH to the install directory, e.g.\n' +
      '  SANCTUARY_PATH="D:/SteamLibrary/steamapps/common/Sanctuary Shattered Sun Demo"',
  );
}

function steamLibraries() {
  const libraries = [];
  for (const root of STEAM_ROOTS) {
    if (!root || !fs.existsSync(root)) continue;
    libraries.push(root);

    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(vdf)) continue;
    // Pull every "path" entry out of the VDF; a full VDF parser is overkill here.
    const text = fs.readFileSync(vdf, 'utf8');
    for (const match of text.matchAll(/"path"\s*"([^"]+)"/g)) {
      libraries.push(match[1].replace(/\\\\/g, '/'));
    }
  }
  return [...new Set(libraries)];
}

// The templates live under the `prototype` build; the `engine` and `map-editor`
// builds ship their own copies but the prototype one is what the game runs.
// The install ships two complete Lua trees with different balance data, and 89
// of 283 units disagree between them:
//
//   engine/LJ/lua              newer (Aug 12 vs Jul 22), 283-entry availability
//                              list with structured notes. Ships no art at all.
//   prototype/RuntimeContent   older data, but holds every unit model, the
//                              strategic icons and the baked map scenes.
//
// Unit data comes from `engine`; art is taken from `prototype`, the only place
// it exists. Set SANCTUARY_TREE=prototype to read the older data instead.
const TREES = {
  engine: path.join('engine', 'LJ', 'lua'),
  prototype: path.join('prototype', 'RuntimeContent', 'Lua'),
};

export function contentRoot(gameDir) {
  const requested = process.env.SANCTUARY_TREE;
  if (requested && !TREES[requested]) {
    throw new Error(`SANCTUARY_TREE must be one of: ${Object.keys(TREES).join(', ')}`);
  }

  const order = requested ? [requested] : ['engine', 'prototype'];
  for (const tree of order) {
    const root = path.join(gameDir, TREES[tree]);
    if (fs.existsSync(path.join(root, 'common', 'units', 'unitsTemplates'))) {
      return { root, tree };
    }
  }

  throw new Error(
    `No unit templates found under ${gameDir}. Looked in:\n` +
      order.map((t) => `  ${path.join(gameDir, TREES[t])}`).join('\n'),
  );
}

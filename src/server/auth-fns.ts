// Who am I, and the one bit of account settings. Only server functions in
// this file — client code imports it for the RPC stubs, so anything else
// exported from here would end up in the browser bundle.

import { createServerFn } from '@tanstack/react-start';
import { sql } from './db';
import { loadSessionPlayer, requirePlayer } from './player';
import type { Me } from '../lib/ladder-types';

export const getMe = createServerFn().handler(async (): Promise<Me | null> => loadSessionPlayer());

// Custom display name, shown everywhere instead of the Steam persona.
// An empty string clears it (back to the Steam name).
export const setDisplayName = createServerFn({ method: 'POST' })
  .validator((data: unknown): { name: string } => {
    const d = data as { name?: unknown } | null;
    if (typeof d?.name !== 'string') throw new Error('name required');
    const name = d.name.trim();
    if (name !== '' && !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,22}[A-Za-z0-9]$/.test(name)) {
      throw new Error(
        'Names are 2–24 characters — letters, numbers, spaces, . _ - — starting and ending with a letter or number.',
      );
    }
    return { name };
  })
  .handler(async ({ data }): Promise<Me> => {
    const me = await requirePlayer();
    try {
      await sql()`
        update players set display_name = ${data.name === '' ? null : data.name}
        where id = ${me.playerId}`;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new Error('That name is already taken.', { cause: e });
      }
      throw e;
    }
    return (await loadSessionPlayer()) ?? me;
  });

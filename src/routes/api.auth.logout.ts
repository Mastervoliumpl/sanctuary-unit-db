// Sign out: clear the session cookies. POST (the chip calls it with fetch and
// reloads) so a hostile <img src> can't log people out.

import { createFileRoute } from '@tanstack/react-router';
import { clearSessionCookies } from '../server/session';

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: () => {
        const headers = new Headers();
        for (const cookie of clearSessionCookies()) headers.append('Set-Cookie', cookie);
        return new Response(null, { status: 204, headers });
      },
    },
  },
});

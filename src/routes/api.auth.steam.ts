// Server-only route: bounces the player to Steam's OpenID sign-in page.
// No component — the auth chip links here with a plain <a>.

import { createFileRoute } from '@tanstack/react-router';
import { steamLoginUrl } from '../server/steam';

export const Route = createFileRoute('/api/auth/steam')({
  server: {
    handlers: {
      GET: () => new Response(null, { status: 302, headers: { Location: steamLoginUrl() } }),
    },
  },
});

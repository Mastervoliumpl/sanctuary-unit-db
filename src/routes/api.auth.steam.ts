// Server-only route: bounces the player to Steam's OpenID sign-in page.
// No component — the auth chip links here with a plain <a>, passing the page
// it was on as ?next= so sign-in lands back there.

import { createFileRoute } from '@tanstack/react-router';
import { steamLoginUrl } from '../server/steam';

export const Route = createFileRoute('/api/auth/steam')({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(null, {
          status: 302,
          headers: { Location: steamLoginUrl(new URL(request.url).searchParams.get('next')) },
        }),
    },
  },
});

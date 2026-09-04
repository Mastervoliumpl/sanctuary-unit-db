// Server-only route: bounces the player to Steam's OpenID sign-in page.
// No component — the auth chip links here with a plain <a>, passing the page
// it was on as ?next=. That path is stashed in a short-lived cookie for the
// callback to land on, rather than riding in return_to.

import { createFileRoute } from '@tanstack/react-router';
import { returnToCookie } from '../server/session';
import { steamLoginUrl } from '../server/steam';
import { safeReturnTo } from '../lib/return-to';

export const Route = createFileRoute('/api/auth/steam')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const next = safeReturnTo(new URL(request.url).searchParams.get('next'));
        return new Response(null, {
          status: 302,
          headers: { Location: steamLoginUrl(), 'Set-Cookie': returnToCookie(next) },
        });
      },
    },
  },
});

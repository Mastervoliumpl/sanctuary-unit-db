import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import { Header } from '../components/Header';
import appCss from '../styles.css?url';

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><path d='M20 8H44L56 20V44L44 56H20L8 44V20Z' fill='none' stroke='%235aa9ff' stroke-width='5'/></svg>";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'SanctuaryDB' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: FAVICON },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Header />
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

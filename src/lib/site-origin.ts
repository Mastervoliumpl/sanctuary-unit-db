/** Validate the public origin shared by canonical links and the sitemap. */
export function siteOrigin(value: string | undefined, required: boolean): string {
  const configured = value?.trim();
  if (!configured) {
    if (required)
      throw new Error(
        'SITE_URL is required for production builds and servers. Set the public HTTP(S) origin.',
      );
    return 'http://localhost:5173';
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('SITE_URL must be an absolute HTTP(S) origin.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('SITE_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.');
  }
  return url.origin;
}

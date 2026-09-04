import type { ModdingSnapshot } from './registry';

export interface ContentPageRecord {
  documentPath: string;
  references: readonly string[];
  snapshotId: string;
  sourcePath: string;
}

export function validateModdingContent(
  snapshots: readonly ModdingSnapshot[],
  pages: readonly ContentPageRecord[],
  navigation: Readonly<Record<string, readonly string[]>>,
): string[] {
  const errors: string[] = [];
  const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.id));
  const pageKeys = new Set<string>();
  const pageUrls = new Set<string>();

  for (const page of pages) {
    const key = `${page.snapshotId}:${page.documentPath}`;
    const url = `/modding/${page.snapshotId}/${page.documentPath}`;
    if (!snapshotIds.has(page.snapshotId))
      errors.push(`Orphaned document for unknown snapshot: ${page.sourcePath}`);
    if (!page.documentPath) errors.push(`Document path is missing: ${page.sourcePath}`);
    if (pageKeys.has(key)) errors.push(`Duplicate document path: ${key}`);
    pageKeys.add(key);
    pageUrls.add(url);
  }

  for (const page of pages) {
    const pageUrl = `/modding/${page.snapshotId}/${page.documentPath}`;
    for (const reference of page.references) {
      if (/^(?:[a-z]+:|#)/i.test(reference)) continue;
      const resolved = new URL(reference, `https://content.invalid${pageUrl}`).pathname.replace(/\/$/, '');
      if (!pageUrls.has(resolved)) errors.push(`Broken internal link in ${page.sourcePath}: ${reference}`);
    }
  }

  for (const snapshot of snapshots) {
    const navKeys = new Set((navigation[snapshot.id] ?? []).map((path) => `${snapshot.id}:${path}`));
    if (!navKeys.has(`${snapshot.id}:${snapshot.startPage}`)) {
      errors.push(`Start page is missing from navigation for ${snapshot.id}: ${snapshot.startPage}`);
    }
    for (const key of pageKeys) {
      if (key.startsWith(`${snapshot.id}:`) && !navKeys.has(key)) errors.push(`Orphaned document: ${key}`);
    }
    for (const key of navKeys) {
      if (!pageKeys.has(key)) errors.push(`Navigation references a missing document: ${key}`);
    }
  }

  return errors;
}

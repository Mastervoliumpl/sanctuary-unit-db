import { loader } from 'fumadocs-core/source';
import { getPageTreeRoots } from 'fumadocs-core/page-tree';
import type { Folder, Node, Root } from 'fumadocs-core/page-tree';
import { siteOrigin } from '../../lib/site-origin';
import { moddingDocs } from './collection';
import {
  DEFAULT_MODDING_SNAPSHOT,
  MODDING_SNAPSHOTS,
  canonicalDocumentUrl,
  formatInspectionDate,
  getModdingSnapshot,
} from './registry';
import type { ModdingSnapshot } from './registry';
import { validateModdingContent } from './validation';

export interface ModdingNavigationDocument {
  path: string;
  title: string;
  description: string;
  url: string;
}

export interface ModdingNavigationGroup {
  title: string;
  documents: ModdingNavigationDocument[];
}

export interface ModdingDocumentData {
  canonicalUrl: string;
  collectionPath: string;
  description: string;
  documentPath: string;
  groups: ModdingNavigationGroup[];
  inspectedOnLabel: string;
  next?: ModdingNavigationDocument;
  previous?: ModdingNavigationDocument;
  snapshots: readonly ModdingSnapshot[];
  snapshot: ModdingSnapshot;
  snapshotDocumentPaths: Record<string, string[]>;
  title: string;
  toc: readonly { depth: number; title: string; url: string }[];
}

export const moddingSource = loader({
  baseUrl: '/modding',
  source: moddingDocs.toFumadocsSource(),
  plugins: ({ typedPlugin }) => [
    typedPlugin({
      name: 'modding-navigation-titles',
      transformPageTree: {
        file(node, filePath) {
          const file = filePath ? this.storage.read(filePath) : undefined;
          if (file?.format === 'page') {
            node.name = file.data.navTitle;
            node.description = file.data.description;
          }
          return node;
        },
      },
    }),
  ],
});

const pageByUrl = new Map(moddingSource.getPages().map((page) => [page.url, page]));

function text(node: unknown): string {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

function rootForSnapshot(tree: Root, snapshotId: string): Root | Folder | undefined {
  const prefix = `/modding/${snapshotId}/`;
  return getPageTreeRoots(tree).find((root) => {
    const stack: Node[] = [...root.children];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.type === 'page' && node.url.startsWith(prefix)) return true;
      if (node.type === 'folder') stack.push(...node.children);
    }
    return false;
  });
}

function navigationForSnapshot(tree: Root, snapshot: ModdingSnapshot): ModdingNavigationGroup[] {
  const root = rootForSnapshot(tree, snapshot.id);
  if (!root) return [];

  const groups: ModdingNavigationGroup[] = [];
  let current: ModdingNavigationGroup | undefined;
  const prefix = `/modding/${snapshot.id}/`;

  const ensureGroup = (title: string) => {
    if (!current || current.title !== title) {
      current = { title, documents: [] };
      groups.push(current);
    }
    return current;
  };

  const visit = (nodes: Node[], fallbackGroup = 'Documentation') => {
    for (const node of nodes) {
      if (node.type === 'separator') {
        current = { title: text(node.name) || fallbackGroup, documents: [] };
        groups.push(current);
        continue;
      }
      if (node.type === 'folder') {
        visit(node.children, text(node.name) || fallbackGroup);
        continue;
      }
      if (!node.url.startsWith(prefix)) continue;

      const page = pageByUrl.get(node.url);
      const documentPath = node.url.slice(prefix.length);
      ensureGroup(current?.title ?? fallbackGroup).documents.push({
        path: documentPath,
        title: page?.data.navTitle ?? text(node.name),
        description: page?.data.description ?? text(node.description),
        url: node.url,
      });
    }
  };

  visit(root.children);
  return groups.filter((group) => group.documents.length > 0);
}

function allNavigationDocuments(groups: readonly ModdingNavigationGroup[]): ModdingNavigationDocument[] {
  return groups.flatMap((group) => group.documents);
}

function validateContent(): void {
  const tree = moddingSource.getPageTree();
  const pages = moddingSource.getPages().map((page) => ({
    documentPath: page.slugs.slice(1).join('/'),
    references: (page.data.extractedReferences ?? []).map((reference) => reference.href),
    snapshotId: page.slugs[0] ?? '',
    sourcePath: page.path,
  }));
  const navigation = Object.fromEntries(
    MODDING_SNAPSHOTS.map((snapshot) => [
      snapshot.id,
      allNavigationDocuments(navigationForSnapshot(tree, snapshot)).map((page) => page.path),
    ]),
  );
  const errors = validateModdingContent(MODDING_SNAPSHOTS, pages, navigation);

  if (errors.length > 0) throw new Error(`Invalid modding content:\n- ${errors.join('\n- ')}`);
}

validateContent();

export async function getModdingDocumentData(
  snapshotId: string,
  documentPath: string,
): Promise<ModdingDocumentData | undefined> {
  const snapshot = getModdingSnapshot(snapshotId);
  const page = moddingSource.getPage([snapshotId, ...documentPath.split('/').filter(Boolean)]);
  if (!snapshot || !page) return undefined;

  const tree = moddingSource.getPageTree();
  const groups = navigationForSnapshot(tree, snapshot);
  const documents = allNavigationDocuments(groups);
  const index = documents.findIndex((entry) => entry.path === documentPath);
  if (index < 0) return undefined;

  const siteUrl = siteOrigin(process.env.SITE_URL, process.env.NODE_ENV === 'production');
  return {
    canonicalUrl: canonicalDocumentUrl(siteUrl, snapshot.id, documentPath),
    collectionPath: page.path,
    description: page.data.description,
    documentPath,
    groups,
    inspectedOnLabel: formatInspectionDate(snapshot.inspectedOn),
    next: documents[index + 1],
    previous: documents[index - 1],
    snapshots: MODDING_SNAPSHOTS,
    snapshot,
    snapshotDocumentPaths: Object.fromEntries(
      MODDING_SNAPSHOTS.map((entry) => [
        entry.id,
        moddingSource
          .getPages()
          .filter((candidate) => candidate.slugs[0] === entry.id)
          .map((candidate) => candidate.slugs.slice(1).join('/')),
      ]),
    ),
    title: page.data.title,
    toc: page.data.toc
      .filter((item) => item.depth > 1)
      .map((item) => ({
        depth: item.depth,
        title:
          page.data.structuredData.headings.find((heading) => `#${heading.id}` === item.url)?.content ??
          item.url,
        url: item.url,
      })),
  };
}

export function getDefaultModdingLocation(): { snapshotId: string; documentPath: string } {
  return {
    snapshotId: DEFAULT_MODDING_SNAPSHOT.id,
    documentPath: DEFAULT_MODDING_SNAPSHOT.startPage,
  };
}

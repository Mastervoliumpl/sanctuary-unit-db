import generated from '../../../.tanstack/modding-navigation.json';
import {
  canonicalDocumentUrl,
  formatInspectionDate,
  getModdingSnapshot,
  MODDING_SNAPSHOTS,
} from './registry';
import type { ModdingDocumentData } from './source.server';

const index = generated as {
  origin: string;
  groups: Record<string, ModdingDocumentData['groups']>;
  pages: Record<string, Pick<ModdingDocumentData, 'collectionPath' | 'title' | 'description' | 'toc'>>;
};

export function getStaticModdingDocument(
  snapshotId: string,
  documentPath: string,
): ModdingDocumentData | undefined {
  const snapshot = getModdingSnapshot(snapshotId);
  const key = `${snapshotId}/${documentPath}`;
  const page = Object.hasOwn(index.pages, key) ? index.pages[key] : undefined;
  const groups = index.groups[snapshotId];
  if (!snapshot || !page || !groups) return undefined;
  const documents = groups.flatMap((group) => group.documents);
  const position = documents.findIndex((entry) => entry.path === documentPath);
  if (position < 0) return undefined;
  return {
    ...page,
    canonicalUrl: canonicalDocumentUrl(index.origin, snapshotId, documentPath),
    documentPath,
    groups,
    inspectedOnLabel: formatInspectionDate(snapshot.inspectedOn),
    next: documents[position + 1],
    previous: documents[position - 1],
    snapshots: MODDING_SNAPSHOTS,
    snapshot,
    snapshotDocumentPaths: Object.fromEntries(
      Object.entries(index.groups).map(([id, entries]) => [
        id,
        entries.flatMap((group) => group.documents.map((document) => document.path)),
      ]),
    ),
  };
}

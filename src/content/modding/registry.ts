import { z } from 'zod';
import snapshot25019767 from './snapshots/0.0.1.11-25019767/snapshot.json' with { type: 'json' };

const pathPattern = /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/;
const snapshotIdPattern = /^[a-z0-9][a-z0-9.-]*$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export const snapshotSchema = z
  .object({
    id: z.string().regex(snapshotIdPattern),
    gameVersion: z.string().trim().min(1),
    steamApp: z.number().int().positive(),
    steamBuild: z.number().int().positive(),
    unityVersion: z.string().trim().min(1),
    status: z.string().trim().min(1),
    inspectedOn: z.string().regex(isoDatePattern),
    startPage: z.string().regex(pathPattern),
  })
  .superRefine((value, context) => {
    const date = new Date(`${value.inspectedOn}T00:00:00Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value.inspectedOn) {
      context.addIssue({
        code: 'custom',
        path: ['inspectedOn'],
        message: 'must be a real ISO calendar date',
      });
    }
  });

export type ModdingSnapshot = z.infer<typeof snapshotSchema>;

export function createSnapshotRegistry(input: readonly unknown[]): readonly ModdingSnapshot[] {
  const snapshots = input.map((entry) => snapshotSchema.parse(entry));
  const ids = new Set<string>();
  const builds = new Set<number>();

  for (const snapshot of snapshots) {
    if (ids.has(snapshot.id)) throw new Error(`Duplicate snapshot ID: ${snapshot.id}`);
    if (builds.has(snapshot.steamBuild)) throw new Error(`Duplicate Steam build ID: ${snapshot.steamBuild}`);
    ids.add(snapshot.id);
    builds.add(snapshot.steamBuild);
  }

  return [...snapshots].sort((left, right) => right.steamBuild - left.steamBuild);
}

export const MODDING_SNAPSHOTS = createSnapshotRegistry([snapshot25019767]);
export const DEFAULT_MODDING_SNAPSHOT = MODDING_SNAPSHOTS[0];

export function getModdingSnapshot(id: string): ModdingSnapshot | undefined {
  return MODDING_SNAPSHOTS.find((snapshot) => snapshot.id === id);
}

export function formatInspectionDate(value: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}

export function canonicalDocumentUrl(siteUrl: string, snapshotId: string, documentPath: string): string {
  const origin = siteUrl.replace(/\/$/, '');
  return `${origin}/modding/${snapshotId}/${documentPath}`;
}

export function resolveVersionSwitch(
  target: ModdingSnapshot,
  currentDocumentPath: string,
  availablePaths: readonly string[],
): { documentPath: string; fallbackFrom?: string } {
  return availablePaths.includes(currentDocumentPath)
    ? { documentPath: currentDocumentPath }
    : { documentPath: target.startPage, fallbackFrom: currentDocumentPath };
}

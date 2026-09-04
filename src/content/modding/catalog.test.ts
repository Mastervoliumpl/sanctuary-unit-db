import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getModdingDocumentData, moddingSource } from './source.server';
import {
  canonicalDocumentUrl,
  createSnapshotRegistry,
  resolveVersionSwitch,
  snapshotSchema,
} from './registry';
import type { ModdingSnapshot } from './registry';
import { validateModdingContent } from './validation';

const snapshot = (overrides: Partial<ModdingSnapshot> = {}): ModdingSnapshot => ({
  gameVersion: '0.0.1.11',
  id: '0.0.1.11-25019767',
  inspectedOn: '2026-09-01',
  startPage: 'start',
  status: 'Community research snapshot',
  steamApp: 4511930,
  steamBuild: 25019767,
  unityVersion: '2022.3.62f3',
  ...overrides,
});

describe('modding snapshot registry', () => {
  it('chooses the greatest numeric Steam build regardless of source order', () => {
    const older = snapshot({ id: 'older-9', steamBuild: 9 });
    const newer = snapshot({ id: 'newer-10', steamBuild: 10 });

    expect(createSnapshotRegistry([older, newer]).map((entry) => entry.id)).toEqual(['newer-10', 'older-9']);
    expect(createSnapshotRegistry([newer, older]).map((entry) => entry.id)).toEqual(['newer-10', 'older-9']);
  });

  it('rejects duplicate snapshot IDs and Steam build IDs', () => {
    expect(() => createSnapshotRegistry([snapshot(), snapshot({ steamBuild: 25019768 })])).toThrow(
      'Duplicate snapshot ID',
    );
    expect(() => createSnapshotRegistry([snapshot(), snapshot({ id: 'another-build' })])).toThrow(
      'Duplicate Steam build ID',
    );
  });

  it('rejects missing metadata and invalid inspection dates', () => {
    expect(() => snapshotSchema.parse({ ...snapshot(), unityVersion: undefined })).toThrow();
    expect(() => snapshotSchema.parse({ ...snapshot(), inspectedOn: '2026-02-30' })).toThrow(
      'must be a real ISO calendar date',
    );
    expect(() => snapshotSchema.parse({ ...snapshot(), inspectedOn: '1 September 2026' })).toThrow();
  });

  it('builds canonical URLs only from the configured site origin', () => {
    expect(canonicalDocumentUrl('https://docs.example/', snapshot().id, 'lua/overview')).toBe(
      'https://docs.example/modding/0.0.1.11-25019767/lua/overview',
    );
  });

  it('preserves a document during a version switch or reports the fallback', () => {
    const target = snapshot({ id: 'target-1', startPage: 'start' });
    expect(resolveVersionSwitch(target, 'lua/overview', ['start', 'lua/overview'])).toEqual({
      documentPath: 'lua/overview',
    });
    expect(resolveVersionSwitch(target, 'managed', ['start'])).toEqual({
      documentPath: 'start',
      fallbackFrom: 'managed',
    });
  });
});

describe('modding content validation', () => {
  const pages = [
    {
      documentPath: 'start',
      references: ['./lua/overview'],
      snapshotId: snapshot().id,
      sourcePath: 'start.mdx',
    },
    {
      documentPath: 'lua/overview',
      references: [],
      snapshotId: snapshot().id,
      sourcePath: 'lua/overview.mdx',
    },
  ];

  it('accepts an ordered navigation tree with valid internal links', () => {
    expect(
      validateModdingContent([snapshot()], pages, { [snapshot().id]: ['start', 'lua/overview'] }),
    ).toEqual([]);
  });

  it('finds broken links, orphaned pages, missing pages, and duplicate paths', () => {
    const result = validateModdingContent(
      [snapshot()],
      [
        { ...pages[0], references: ['./missing'] },
        pages[1],
        { ...pages[1], sourcePath: 'duplicate.mdx' },
        { ...pages[1], snapshotId: 'unknown-snapshot', sourcePath: 'unknown.mdx' },
      ],
      { [snapshot().id]: ['start', 'missing-nav-page'] },
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Broken internal link'),
        expect.stringContaining('Duplicate document path'),
        expect.stringContaining('Orphaned document for unknown snapshot'),
        expect.stringContaining('Orphaned document: 0.0.1.11-25019767:lua/overview'),
        expect.stringContaining('Navigation references a missing document'),
      ]),
    );
  });
});

describe('compiled Fumadocs source', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps source metadata available without serializing unused route fields', async () => {
    vi.stubEnv('SITE_URL', 'https://docs.example');
    const page = await getModdingDocumentData(snapshot().id, 'lua/overview');
    const sourcePage = moddingSource.getPage([snapshot().id, 'lua', 'overview']);
    const files = readdirSync(join(import.meta.dirname, 'docs', snapshot().id), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.mdx'));

    expect(page).toBeDefined();
    expect([...page!.snapshotDocumentPaths[snapshot().id]].sort()).toEqual(
      files.map((file) => file.replaceAll('\\', '/').replace(/\.mdx$/, '')).sort(),
    );
    expect(page).not.toHaveProperty('pageTree');
    expect(page).not.toHaveProperty('structuredData');
    expect(page).not.toHaveProperty('references');
    expect(page?.toc.some((entry) => entry.url === '#multiplayer-lua-hash-gate')).toBe(true);
    expect(
      sourcePage?.data.structuredData.headings.some((entry) => entry.id === 'multiplayer-lua-hash-gate'),
    ).toBe(true);
    expect(sourcePage?.data.extractedReferences?.map((entry) => entry.href)).toContain('./import');
    expect(page?.canonicalUrl).toBe('https://docs.example/modding/0.0.1.11-25019767/lua/overview');
  });
});

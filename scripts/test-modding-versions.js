import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

// Build fixture snapshots in an isolated copy. They never enter production content.
const root = process.cwd();
const results = realpathSync(tmpdir());
const temporary = mkdtempSync(join(results, 'sanctuary-modding-versions-'));
const dependencies = join(temporary, 'node_modules');
const environment = { ...process.env, SITE_URL: 'http://localhost:4174', MODDING_TEST_ROOT: temporary };

function cleanFixture() {
  if (
    dirname(realpathSync(temporary)) !== realpathSync(results) ||
    !basename(temporary).startsWith('sanctuary-modding-versions-')
  ) {
    throw new Error('Unexpected fixture directory; refusing cleanup');
  }
  if (existsSync(dependencies)) unlinkSync(dependencies);
  rmSync(temporary, { recursive: true, force: true });
}

try {
  for (const entry of ['src', 'public', 'package.json', 'vite.config.ts', 'tsconfig.json']) {
    cpSync(join(root, entry), join(temporary, entry), { recursive: true });
  }
  symlinkSync(join(root, 'node_modules'), dependencies, process.platform === 'win32' ? 'junction' : 'dir');
  const content = join(temporary, 'src/content/modding');
  const id = 'test-snapshot-1';
  mkdirSync(join(content, 'snapshots', id), { recursive: true });
  writeFileSync(
    join(content, 'snapshots', id, 'snapshot.json'),
    JSON.stringify({
      id,
      gameVersion: 'Test',
      steamApp: 4511930,
      steamBuild: 1,
      unityVersion: 'Test',
      status: 'Test fixture',
      inspectedOn: '2026-01-01',
      startPage: 'start',
    }),
  );
  mkdirSync(join(content, 'docs', id, 'lua'), { recursive: true });
  writeFileSync(
    join(content, 'docs', id, 'meta.json'),
    JSON.stringify({ title: 'Test fixture', root: true, pages: ['start', 'lua'] }),
  );
  writeFileSync(
    join(content, 'docs', id, 'lua/meta.json'),
    JSON.stringify({ title: 'Lua', pages: ['overview'] }),
  );
  for (const [path, title] of [
    ['start', 'Test snapshot start'],
    ['lua/overview', 'Test Lua overview'],
  ]) {
    writeFileSync(
      join(content, 'docs', id, `${path}.mdx`),
      `---\ntitle: ${title}\ndescription: Version-switch test fixture.\nnavTitle: ${title}\n---\n\n# ${title}\n\nThis document exists only in the isolated browser-test build.\n`,
    );
  }
  const registry = join(content, 'registry.ts');
  const source = readFileSync(registry, 'utf8');
  if (!source.includes('createSnapshotRegistry([')) throw new Error('Cannot register test snapshot');
  writeFileSync(
    registry,
    `import testSnapshot from './snapshots/${id}/snapshot.json' with { type: 'json' };\n` +
      source.replace('createSnapshotRegistry([', 'createSnapshotRegistry([testSnapshot, '),
  );
  execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: temporary,
    env: environment,
    stdio: 'inherit',
  });
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.versions.config.ts'],
    { cwd: root, env: environment, stdio: 'inherit' },
  );
} finally {
  // Check the resolved cleanup boundary before deleting the temporary copy.
  cleanFixture();
}

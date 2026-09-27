/*
 * Verifies the packaged CLI artifact can build and run from a clean workspace.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const packageJsonPath = path.join(repoRoot, 'package.json');
const liveObservedStatePath = path.join(repoRoot, 'dist/application/observed-state.js');
const stagedCopyIgnores = new Set(['.git', 'dist', 'dist-test', 'node_modules']);

/*
 * prepack runs tsc, which truncates each dist file before writing it back.
 * Packing the live repo races hermetic tests that are loading those modules.
 */
async function stagePackProject(destination: string): Promise<void> {
  await cp(repoRoot, destination, {
    recursive: true,
    filter(source) {
      const relativePath = path.relative(repoRoot, source);

      if (!relativePath) {
        return true;
      }

      const [topLevel] = relativePath.split(path.sep);

      return !stagedCopyIgnores.has(topLevel);
    }
  });
  await symlink(path.join(repoRoot, 'node_modules'), path.join(destination, 'node_modules'), 'dir');
}

test('package smoke: npm pack includes the published CLI entrypoint and metadata', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-pack-'));
  const stageDir = path.join(tempDir, 'stage');
  const npmCacheDir = path.join(tempDir, 'npm-cache');
  const observedStateBefore = await stat(liveObservedStatePath);

  await stagePackProject(stageDir);

  const packResult = spawnSync(
    'npm',
    ['pack', '--json', '--pack-destination', tempDir],
    {
      cwd: stageDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        npm_config_cache: npmCacheDir
      }
    }
  );

  assert.equal(packResult.status, 0, packResult.stderr);
  const [packInfo] = JSON.parse(packResult.stdout) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    name: string;
    version: string;
  };
  const tarballPath = path.join(tempDir, packInfo.filename);
  const tarListResult = spawnSync('tar', ['-tzf', tarballPath], {
    encoding: 'utf8'
  });
  const extractedPackageJson = spawnSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
    encoding: 'utf8'
  });

  assert.equal(tarListResult.status, 0, tarListResult.stderr);
  assert.equal(extractedPackageJson.status, 0, extractedPackageJson.stderr);
  assert.ok(
    packInfo.files.some((file) => file.path === 'dist/cli/index.js'),
    'dist/cli/index.js should be included in the tarball metadata'
  );
  assert.match(tarListResult.stdout, /package\/dist\/cli\/index\.js/);
  assert.match(tarListResult.stdout, /package\/hooks\/pre-commit/);
  assert.match(tarListResult.stdout, /package\/shell\/gitrole-prompt/);
  assert.match(tarListResult.stdout, /package\/completions\/gitrole\.bash/);
  assert.match(tarListResult.stdout, /package\/completions\/_gitrole/);
  assert.match(tarListResult.stdout, /package\/completions\/gitrole\.fish/);
  assert.match(tarListResult.stdout, /package\/package\.json/);
  assert.match(tarListResult.stdout, /package\/skills\/gitrole\/SKILL\.md/);
  assert.ok(
    packInfo.files.some((file) => file.path === 'skills/gitrole/SKILL.md'),
    'skills/gitrole/SKILL.md should be included in the tarball metadata'
  );

  const packedManifest = JSON.parse(extractedPackageJson.stdout) as {
    name: string;
    version: string;
    bin: Record<string, string>;
  };

  assert.equal(packedManifest.name, packageJson.name);
  assert.equal(packedManifest.version, packageJson.version);
  assert.deepEqual(packedManifest.bin, {
    gitrole: 'dist/cli/index.js',
    'gitrole-prompt': 'shell/gitrole-prompt'
  });

  const observedStateAfter = await stat(liveObservedStatePath);
  assert.equal(
    observedStateAfter.mtimeMs,
    observedStateBefore.mtimeMs,
    'npm pack must not rebuild the dist tree other e2e tests are executing'
  );
});

const installSmoke = process.env.GITROLE_RUN_INSTALL_SMOKE === '1' ? test : test.skip;

installSmoke('package smoke: tarball installs and runs gitrole --help', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-install-smoke-'));
  const stageDir = path.join(tempDir, 'stage');
  const npmCacheDir = path.join(tempDir, 'npm-cache');
  const consumerDir = path.join(tempDir, 'consumer');

  await stagePackProject(stageDir);

  const packResult = spawnSync(
    'npm',
    ['pack', '--json', '--pack-destination', tempDir],
    {
      cwd: stageDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        npm_config_cache: npmCacheDir
      }
    }
  );

  assert.equal(packResult.status, 0, packResult.stderr);
  const [packInfo] = JSON.parse(packResult.stdout) as Array<{ filename: string }>;
  const tarballPath = path.join(tempDir, packInfo.filename);

  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    path.join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'gitrole-install-smoke', private: true }, null, 2),
    'utf8'
  );
  await writeFile(path.join(consumerDir, '.npmrc'), 'fund=false\naudit=false\n', 'utf8');

  const installResult = spawnSync('npm', ['install', tarballPath], {
    cwd: consumerDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      npm_config_cache: npmCacheDir
    }
  });

  assert.equal(installResult.status, 0, installResult.stderr);

  const helpResult = spawnSync(path.join(consumerDir, 'node_modules', '.bin', 'gitrole'), ['--help'], {
    cwd: consumerDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0'
    }
  });

  assert.equal(helpResult.status, 0, helpResult.stderr);
  assert.match(helpResult.stdout, /Manage named git identities and diagnose repo alignment/);
});

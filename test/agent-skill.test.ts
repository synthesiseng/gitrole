/* Locks the packaged instructions to separate local commit and push decisions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const read = (file: string) => readFile(path.join(repoRoot, file), 'utf8');
const workflow = (name: string) => read(`skills/gitrole/references/${name}.md`);
const plain = (text: string) => text.replace(/<[^>]+>/g, '').replace(/`/g, '');

test('packaged skill requires the supported local command for ordinary commits', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const skill = await read('skills/gitrole/SKILL.md');
  assert.ok(pkg.files.includes('skills'));
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter);
  assert.match(frontmatter[1], /^name: gitrole$/m);
  assert.match(frontmatter[1], /^description: .*(identity|author).*$/m);
  assert.match(frontmatter[1], /compatibility:.*0\.12\.0/);
  const commit = (await workflow('commit-preflight')).split('## Ordinary commits')[1]?.split('\n## ')[0];
  assert.ok(commit, 'ordinary commits need a distinct decision, separate from push diagnosis');
  assert.match(commit, /```bash\ngitrole check commit\n```/);
  assert.doesNotMatch(commit, /```bash\ngitrole (?:status|auth)/);
  assert.match(commit, /Exit `0`/);
  assert.match(commit, /Exit `2`/);
  assert.match(commit, /Exit `1`/);
  assert.match(commit, /no output|quiet/);
  assert.match(commit, /no remote/i);
  assert.match(commit, /first commit.*local|local.*first commit/i);
  assert.match(skill, /gitrole check commit --help/);
  assert.match(skill, /Do not install or upgrade/);
  assert.match(skill, /Do not fall back to.*status/);
});

test('commit diagnosis is offline and keeps effective identity and author limits explicit', async () => {
  const skill = await workflow('commit-preflight');
  assert.match(skill, /gitrole doctor --offline --json/);
  assert.match(skill, /commitIdentity/);
  assert.match(skill, /committerIdentity/);
  assert.match(skill, /configuredIdentity/);
  assert.match(skill, /GIT_AUTHOR_EMAIL/);
  assert.match(skill, /GIT_COMMITTER_EMAIL/);
  assert.match(skill, /amend.*retain|retains.*author/i);
  assert.match(skill, /--author/);
  assert.match(skill, /later.*(?:environment|configuration)|(?:environment|configuration).*changes/);
  assert.match(skill, /Do not filter/);
});

test('push diagnosis retains status contract and cannot approve an explicit destination', async () => {
  const skill = await workflow('push-diagnosis');
  const push = skill.split('## Pushes')[1]?.split('\n## ')[0];
  assert.ok(push);
  assert.match(push, /gitrole status --short/);
  assert.match(push, /role scope override commit remote auth policy overall/);
  assert.match(push, /eighth field/);
  assert.match(push, /Do not push/);
  assert.match(push, /every Git-resolved.*push URL/);
  assert.match(push, /explicit.*(?:destination|arguments)/);
  assert.match(push, /no (?:destination|target).*option/i);
  assert.match(push, /HTTPS/);
  assert.match(push, /auth=na/);
  assert.match(push, /Match exec/);
});

test('remediation and interactive authentication require the human', async () => {
  const skill = await read('skills/gitrole/SKILL.md');
  assert.match(skill, /user.*(?:choose|chooses).*role/i);
  for (const command of ['use', 'pin', 'remote set']) assert.ok(skill.includes(`gitrole ${command}`));
  assert.match(skill, /Never switch globally/);
  assert.match(await workflow('commit-preflight'), /Leave it uninstalled unless the user asks/);
  assert.match(await workflow('push-diagnosis'), /ask.*run.*gitrole auth test.*terminal/i);
  assert.match(await workflow('push-diagnosis'), /Never invoke it automatically/);
});

test('related public guidance consistently separates commit and push checks', async () => {
  for (const file of [
    'skills/gitrole/SKILL.md',
    'docs/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation.md'
  ]) {
    const text = plain(await read(file));
    assert.match(text, /check commit[^.]*commit gate/i, file);
    assert.match(text, /doctor --offline --json/, file);
    assert.match(text, /status --short/, file);
    assert.match(text, /amend/, file);
    assert.doesNotMatch(text, /status --short[^.]*precommit gate|Do not commit or push/i, file);
  }
  for (const file of [
    'README.md', 'docs/machine-readable-contracts.md',
    'docs/guides/check-identity-before-a-local-commit.md'
  ]) {
    const text = plain(await read(file));
    assert.doesNotMatch(text, /(?:agent skill|skill's)[^.]*strict|agent skill[^.]*retain.*existing contract|agent skill still runs[^.]*status/i, file);
  }
});


test('all skill references resolve inside the packaged skill folder', async () => {
  const root = path.join(repoRoot, 'skills/gitrole');
  const files = ['SKILL.md', 'references/identity-and-policy.md', 'references/commit-preflight.md', 'references/push-diagnosis.md'];
  for (const file of files) {
    const text = await read(`skills/gitrole/${file}`);
    for (const link of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(link[1])) continue;
      const resolved = path.resolve(root, path.dirname(file), link[1]);
      assert.ok(resolved.startsWith(root + path.sep), `${file}: reference escapes skill folder`);
      assert.ok((await stat(resolved)).isFile(), `${file}: missing reference ${link[1]}`);
    }
  }
  const entry = await read('skills/gitrole/SKILL.md');
  for (const file of files.slice(1)) assert.ok(entry.includes(`](${file})`), `undiscoverable workflow: ${file}`);
});

test('identity workflow separates saving, applying and policy without adding network gates', async () => {
  const identity = await workflow('identity-and-policy');
  for (const command of ['gitrole add', 'gitrole import current', 'gitrole use', 'gitrole pin', 'gitrole resolve --json']) {
    assert.ok(identity.includes(command), `missing workflow: ${command}`);
  }
  assert.match(identity, /--local/);
  assert.match(identity, /--global.*global Git configuration/);
  assert.match(identity, /ssh-add/);
  assert.match(identity, /replaces an existing/);
  assert.match(identity, /Missing or invalid policy exits `1`/);
  assert.match(identity, /missing `\.gitrole` is allowed/);
  assert.match(identity, /No network check is required/);
});


test('npm package contains the complete discoverable skill folder', () => {
  // Ignore lifecycle scripts: this checks packaging, not compiler availability.
  const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  }));
  const paths = new Set(packed[0].files.map((file: { path: string }) => file.path));
  for (const file of ['SKILL.md', 'references/identity-and-policy.md', 'references/commit-preflight.md', 'references/push-diagnosis.md']) {
    assert.ok(paths.has(`skills/gitrole/${file}`), `npm package omits ${file}`);
  }
});

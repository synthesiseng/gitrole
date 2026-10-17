/* Locks the packaged instructions to separate local commit and push decisions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (file: string) => readFile(path.join(repoRoot, file), 'utf8');
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
  const commit = skill.split('## Ordinary commits')[1]?.split('\n## ')[0];
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
  const skill = await read('skills/gitrole/SKILL.md');
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
  const skill = await read('skills/gitrole/SKILL.md');
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
  assert.match(skill, /Leave it uninstalled unless the user asks/);
  assert.match(skill, /ask.*run.*gitrole auth test.*terminal/i);
  assert.match(skill, /Never invoke it automatically/);
});

test('related public guidance consistently separates commit and push checks', async () => {
  for (const file of [
    'skills/gitrole/SKILL.md',
    'docs/guides/verify-git-identity-before-an-agent-commits.md',
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

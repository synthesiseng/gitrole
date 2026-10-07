/*
 * Locks the published agent skill to the status --short and doctor --json stop rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const skillPath = path.join(repoRoot, 'skills/gitrole/SKILL.md');

test('agent skill is packaged and tells agents to stop on warning', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
    files: string[];
  };
  const skill = await readFile(skillPath, 'utf8');
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);

  assert.ok(frontmatter, 'SKILL.md should start with YAML frontmatter');
  assert.match(frontmatter[1], /^name: gitrole$/m);
  assert.match(frontmatter[1], /^description: .*(commit|push).*$/m);
  assert.ok(
    packageJson.files.includes('skills'),
    'package.json files should include the skills directory'
  );
  assert.match(skill, /gitrole status --short/);
  assert.match(skill, /gitrole doctor --json/);
  assert.match(skill, /eighth field/);
  assert.match(skill, /role scope override commit remote auth policy overall/);
  assert.match(skill, /Exit `0`/);
  assert.match(skill, /Exit `2`/);
  assert.match(skill, /Exit `1`/);
  assert.match(skill, /overall=warning/);
  assert.match(skill, /Do not commit or push/);
  assert.match(skill, /Leave it uninstalled unless the user asks/);
  assert.match(skill, /GIT_AUTHOR_EMAIL/);
  assert.match(skill, /GIT_COMMITTER_EMAIL/);
  assert.match(skill, /commitIdentity/);
  assert.match(skill, /configuredIdentity/);
  assert.match(skill, /role=no-role scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning/);
  assert.match(skill, /auth=warn policy=na overall=warning/);
  assert.match(skill, /no commits and no local role/);
  assert.match(skill, /commit=warn remote=ok auth=ok policy=na overall=warning/);
  assert.match(skill, /not branch readiness, push permission or successful push/);
  assert.match(skill, /every Git-resolved push URL/);
});

test('agent guidance uses status as the gate and keeps doctor history diagnostics separate', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const guide = await readFile(path.join(repoRoot, 'docs/guides/verify-git-identity-before-an-agent-commits.md'), 'utf8');
  const automation = await readFile(path.join(repoRoot, 'docs/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation.md'), 'utf8');
  for (const document of [skill, guide, automation]) {
    const text = document.replace(/<[^>]+>/g, '').replace(/`/g, '');
    assert.match(text, /status --short[^.]*precommit gate/i);
    assert.match(text, /doctor[^.]*not[^.]*substitute/i);
    assert.match(text, /no commits|no history|missing.history/i);
    assert.match(text, /Do not[^.]*status warning/i);
  }
  assert.doesNotMatch(skill, /Run the chosen command|Prefer the first command/);
  assert.doesNotMatch(automation, /status --short<\/code> or <code>gitrole doctor --json/);
});

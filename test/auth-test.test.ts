/* Verifies explicit auth observations against real Git and isolated SSH executables. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import childProcess, { spawnSync, spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SystemAuthTester } from '../src/adapters/auth-test.js';
import { parseRemoteUrl } from '../src/adapters/git-repository.js';

const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-auth-'));
  const cleanup: (() => void)[] = [];
  t.after(async () => { for (const stop of cleanup) stop(); await rm(root, { recursive: true, force: true }); });
  await mkdir(path.join(root, 'bin')); await mkdir(path.join(root, 'config')); await mkdir(path.join(root, 'home'));
  const env: NodeJS.ProcessEnv = { PATH: `${root}/bin:${process.env.PATH}`, HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', NO_COLOR: '1', ROOT: root };
  const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git('init', '-q'); git('config', 'user.name', 'Fixture User'); git('config', 'user.email', 'fixture@example.invalid');
  git('remote', 'add', 'origin', 'git@fixture.invalid:team/repo.git');
  const roles = `${root}/config/gitrole/roles.json`;
  const setRole = async (githubUser?: string) => { await mkdir(path.dirname(roles), { recursive: true }); await writeFile(roles, JSON.stringify({ roles: [{ name: 'fixture', fullName: 'Fixture User', email: 'fixture@example.invalid', ...(githubUser ? { githubUser } : {}) }] })); };
  const ssh = async (body: string) => writeFile(`${root}/bin/ssh`, `#!${process.execPath}\n${body}`, { mode: 0o755 });
  const stub = (account = 'fixture-user', exit = 1, extra = '') => `const fs = require('fs'); fs.appendFileSync(process.env.ROOT+'/calls', JSON.stringify(process.argv.slice(2))+'\\n');
if(process.argv.includes('-G')) { console.log('hostname fixture.invalid\\nuser git\\nport 22\\nremotecommand none'); }
else { ${extra} console.error("Hi ${account}! You've successfully authenticated, but GitHub does not provide shell access."); process.exitCode=${exit}; }`;
  await ssh(stub());
  const run = (extraEnv = {}) => spawnSync(process.execPath, [cli, 'auth', 'test'], { cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 15000 });
  return { root, env, git, ssh, stub, setRole, roles, run, cleanup };
}

test('observed match, literal mismatch and absent expectation; no config or history writes', async t => {
  const f = await fixture(t); await f.setRole('fixture-user');
  const config = await readFile(`${f.root}/.git/config`); const roles = await readFile(f.roles);
  let r = f.run(); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Authenticated as: fixture-user/);
  assert.match(r.stdout, /does not guarantee/); assert.match(r.stdout, /Checked: \d{4}-/);
  assert.deepEqual(await readFile(`${f.root}/.git/config`), config); assert.deepEqual(await readFile(f.roles), roles);
  await f.setRole('other-user'); r = f.run(); assert.equal(r.status, 2); assert.match(r.stdout, /Mismatch: observed fixture-user, role expects other-user/);
  await f.setRole(); r = f.run(); assert.equal(r.status, 0); assert.match(r.stdout, /expectation: not configured/);
  await rm(path.dirname(f.roles), { recursive: true }); r = f.run(); assert.equal(r.status, 0);
  await assert.rejects(access(f.roles)); await assert.rejects(access(`${f.root}/home/.local/state`));
});

test('all endpoints retain outcomes, with no early success', async t => {
  const f = await fixture(t); await f.setRole('fixture-user');
  f.git('config', '--add', 'remote.origin.pushurl', 'git@fixture.invalid:team/one');
  f.git('config', '--add', 'remote.origin.pushurl', 'https://example.invalid/team/two');
  const r = f.run(); assert.equal(r.status, 2); assert.match(r.stdout, /Authenticated as: fixture-user/); assert.match(r.stdout, /endpoint 2/);
  assert.equal((await readFile(`${f.root}/calls`, 'utf8')).trim().split('\n').length, 2);
});

test('unsafe URLs and custom transport never execute SSH or expose secrets', async t => {
  const f = await fixture(t);
  for (const url of ['ssh://git:secret@example.invalid/team/repo', 'ssh://git@example.invalid/team/repo?token=secret', 'git@-option:repo', 'git@fixture.invalid:repo\tsecret']) {
    f.git('remote', 'set-url', 'origin', url);
    const r = f.run(); assert.equal(r.status, 2, r.stderr); assert.doesNotMatch(r.stdout + r.stderr, /secret/);
  }
  f.git('remote', 'set-url', 'origin', 'git@fixture.invalid:repo');
  for (const extra of [{ GIT_SSH_COMMAND: 'echo secret' }, { GIT_SSH: '/secret' }, { GITROLE_SSH_BIN: '/secret' }]) {
    const r = f.run(extra); assert.equal(r.status, 2); assert.doesNotMatch(r.stdout + r.stderr, /secret/);
  }
  f.git('config', 'core.sshCommand', 'echo secret'); assert.equal(f.run().status, 2);
  await assert.rejects(access(`${f.root}/calls`));
});

test('unrecognized, duplicate, signalled and nonstandard-exit greetings stay unobserved', async t => {
  const f = await fixture(t);
  for (const body of [f.stub('fixture-user', 255), f.stub('fixture-user', 1, `console.log("Hi other! You've successfully authenticated, but GitHub does not provide shell access.");`), f.stub('fixture-user', 1, `process.kill(process.pid,'SIGTERM');`), `console.log('incomplete');`]) {
    await f.ssh(body); const r = f.run(); assert.equal(r.status, 2); assert.doesNotMatch(r.stdout, /Authenticated as:/);
  }
});

test('nonTTY argv preserves user/port, suppresses prompts and rejects RemoteCommand', async t => {
  const f = await fixture(t); f.git('remote', 'set-url', 'origin', 'ssh://alice@fixture.invalid:2222/team/repo');
  assert.equal(f.run().status, 0);
  const calls = (await readFile(`${f.root}/calls`, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  assert.deepEqual(calls[1], ['-T', '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', '-p', '2222', 'alice@fixture.invalid']);
  await f.ssh(`console.log('hostname fixture.invalid\\nuser git\\nport 22\\nremotecommand forbidden');`);
  assert.equal(f.run().status, 2);
});

test('abort kills the nonTTY process group, including a child that ignores TERM', async t => {
  const f = await fixture(t);
  await f.ssh(`const fs=require('fs'); if(process.argv.includes('-G')) console.log('hostname fixture.invalid\\nuser git\\nport 22\\nremotecommand none'); else { const {spawn}=require('child_process'); const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});const fs=require('fs');setInterval(()=>fs.writeFileSync(process.env.ROOT+'/heartbeat',String(Date.now())),50)"],{stdio:'ignore'});fs.writeFileSync(process.env.ROOT+'/child',String(c.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000); }`);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort('timeout'), 500);
  const start = performance.now();
  const result = await new SystemAuthTester(false, f.env).observe(parseRemoteUrl('origin','git@fixture.invalid:repo'), controller.signal);
  clearTimeout(timer); assert.equal(result.outcome, 'unobserved'); assert.ok(performance.now()-start < 2500);
  const pid = Number(await readFile(`${f.root}/child`, 'utf8'));
  t.after(async () => { try { process.kill(pid, 'SIGKILL'); } catch {} });
  await new Promise(resolve => setTimeout(resolve, 50));
  const heartbeat = await readFile(`${f.root}/heartbeat`, 'utf8');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await readFile(`${f.root}/heartbeat`, 'utf8'), heartbeat, 'descendant continued running after group cleanup');
});

test('interactive cancellation escalates known descendants after leader exit without signalling a peer', async t => {
  for (const [name, childResists, leaderResists] of [
    ['cooperative child', false, false],
    ['TERM-resistant child and early leader exit', true, false],
    ['TERM-resistant leader and child', true, true]
  ] as const) {
    await t.test(name, async t => {
      const f = await fixture(t);
      const peer = spawn(process.execPath, ['-e', `const fs=require('fs');process.on('SIGTERM',()=>fs.writeFileSync(process.env.ROOT+'/peer-signalled','TERM'));setInterval(()=>fs.writeFileSync(process.env.ROOT+'/peer-heartbeat',String(Date.now())),20);`], { env: f.env, stdio: 'ignore' });
      f.cleanup.push(() => { peer.kill('SIGKILL'); });
      await f.ssh(`const fs=require('fs');if(process.argv.includes('-G'))console.log('hostname fixture.invalid\\nuser git\\nport 22');else{
        const {spawn}=require('child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(`const fs=require('fs');process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{fs.writeFileSync(process.env.ROOT+'/child-term','TERM');${childResists ? '' : 'process.exit(0);'}});setInterval(()=>fs.writeFileSync(process.env.ROOT+'/heartbeat',String(Date.now())),20);`)}],{stdio:'ignore'});
        fs.writeFileSync(process.env.ROOT+'/child',String(c.pid));process.on('SIGTERM',()=>{${leaderResists ? '' : 'process.exit(0);'}});setInterval(()=>{},1000);
      }`);
      const controller = new AbortController();
      const observation = new SystemAuthTester(true, f.env).observe(parseRemoteUrl('origin', 'git@fixture.invalid:repo'), controller.signal);
      t.after(async () => {
        controller.abort('cancelled');
        try { process.kill(Number(await readFile(`${f.root}/child`, 'utf8')), 'SIGKILL'); } catch {}
      });
      const deadline = Date.now() + 3000;
      while (true) {
        try { await access(`${f.root}/heartbeat`); break; } catch {
          assert.ok(Date.now() < deadline, 'synthetic SSH child did not start');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      const descendantPid = Number(await readFile(`${f.root}/child`, 'utf8'));
      f.cleanup.push(() => { try { process.kill(descendantPid, 'SIGKILL'); } catch {} });
      // Let the real platform process snapshot observe this long-lived descendant before cancellation.
      await new Promise(resolve => setTimeout(resolve, 350));
      controller.abort('cancelled');
      assert.equal((await observation).outcome, 'cancelled');
      assert.equal(await readFile(`${f.root}/child-term`, 'utf8'), 'TERM');
      const heartbeat = await readFile(`${f.root}/heartbeat`, 'utf8');
      const peerHeartbeat = await readFile(`${f.root}/peer-heartbeat`, 'utf8');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await readFile(`${f.root}/heartbeat`, 'utf8'), heartbeat, 'known SSH descendant survived cleanup');
      assert.notEqual(await readFile(`${f.root}/peer-heartbeat`, 'utf8'), peerHeartbeat, 'unrelated peer stopped');
      await assert.rejects(access(`${f.root}/peer-signalled`));
    });
  }
});

test('interactive cleanup falls back safely on incomplete inspection or a changed PID identity', async t => {
  for (const mode of ['malformed', 'truncated', 'unavailable', 'identity-changed']) {
    await t.test(mode, async t => {
      const f = await fixture(t);
      let cancelling = false, descendantPid = 0, faultReads = 0;
      const original = childProcess.execFile;
      const execute = promisify(original);
      const replacement = (...args: Parameters<typeof original>) => original(...args);
      Object.defineProperty(replacement, promisify.custom, { value: async (file: string, args: string[], options: object) => {
        const result = await execute(file, args, options);
        if (file !== '/bin/ps' || !cancelling) return result;
        faultReads++;
        if (mode === 'truncated' || mode === 'unavailable') throw new Error(mode);
        const stdout = mode === 'malformed' ? result.stdout + '\ninvalid process row\n' :
          result.stdout.split('\n').map(line => Number(line.trim().split(/\s+/)[0]) === descendantPid ? line.replace(/\d{4}\s*$/, '1970') : line).join('\n');
        return { ...result, stdout };
      } });
      // Replace the builtin itself: mock.method's proxy retains execFile's original custom promisifier.
      childProcess.execFile = replacement as typeof original;
      syncBuiltinESMExports();
      t.after(() => { childProcess.execFile = original; syncBuiltinESMExports(); });
      await f.ssh(`const fs=require('fs');if(process.argv.includes('-G'))console.log('hostname fixture.invalid\\nuser git\\nport 22');else{const c=require('child_process').spawn(process.execPath,['-e',"const fs=require('fs');process.on('SIGTERM',()=>fs.writeFileSync(process.env.ROOT+'/child-term','TERM'));setInterval(()=>fs.writeFileSync(process.env.ROOT+'/heartbeat',String(Date.now())),20);"],{stdio:'ignore'});fs.writeFileSync(process.env.ROOT+'/child',String(c.pid));setInterval(()=>{},1000);}`);
      const controller = new AbortController();
      const observation = new SystemAuthTester(true, f.env).observe(parseRemoteUrl('origin', 'git@fixture.invalid:repo'), controller.signal);
      f.cleanup.push(() => { controller.abort('cancelled'); if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch {} } });
      const deadline = Date.now() + 3000;
      while (true) {
        try { await access(`${f.root}/heartbeat`); break; } catch {
          assert.ok(Date.now() < deadline, 'synthetic SSH child did not start');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      descendantPid = Number(await readFile(`${f.root}/child`, 'utf8'));
      await new Promise(resolve => setTimeout(resolve, 350));
      cancelling = true; controller.abort('cancelled');
      assert.equal((await observation).outcome, 'cancelled');
      assert.ok(faultReads >= 2, 'TERM and KILL did not exercise the faulty inspection boundary');
      const heartbeat = await readFile(`${f.root}/heartbeat`, 'utf8');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.notEqual(await readFile(`${f.root}/heartbeat`, 'utf8'), heartbeat, 'uncertain PID was killed');
      await assert.rejects(access(`${f.root}/child-term`));
    });
  }
});

test('CLI Ctrl-C produces 130 and no observed account', async t => {
  const f = await fixture(t); await f.ssh(`setInterval(()=>{},1000);`);
  const child = spawn(process.execPath,[cli,'auth','test'],{ cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe'] });
  let out=''; child.stdout.on('data', d => out+=d); child.stderr.resume();
  const timer=setTimeout(()=>child.kill('SIGINT'),500);
  const code=await new Promise(resolve=>child.on('exit',resolve)); clearTimeout(timer);
  assert.equal(code,130); assert.doesNotMatch(out,/Authenticated as:/);
});


test('actual OpenSSH settings with no remotecommand line are accepted without network', async t => {
  const f = await fixture(t);
  await writeFile(`${f.root}/ssh-config`, 'Host *\n HostName fixture.invalid\n User git\n BatchMode yes\n CanonicalizeHostname no\n');
  await f.ssh(`const {spawnSync}=require('child_process');if(process.argv.includes('-G')) {const r=spawnSync('/usr/bin/ssh',['-F',process.env.ROOT+'/ssh-config',...process.argv.slice(2)],{encoding:'utf8'});process.stdout.write(r.stdout);process.exitCode=r.status;}else{console.error("Hi fixture-user! You've successfully authenticated, but GitHub does not provide shell access.");process.exitCode=1;}`);
  const r=f.run(); assert.equal(r.status,0,r.stderr+r.stdout);
});

test('nonTTY whole-command timeout is bounded and cannot accept a partial greeting', async t => {
  const f=await fixture(t);
  await f.ssh(`if(process.argv.includes('-G')) console.log('hostname fixture.invalid\\nuser git\\nport 22'); else {console.log("Hi fixture-user! You've successfully authenticated, but GitHub does not provide shell access.");process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}`);
  const start=performance.now(); const r=f.run(); const elapsed=performance.now()-start;
  assert.equal(r.status,2,r.stderr); assert.match(r.stdout,/time budget exhausted/); assert.doesNotMatch(r.stdout,/Authenticated as:/);
  assert.ok(elapsed>=9900 && elapsed<12500,`elapsed ${elapsed}`);
});

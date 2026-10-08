/*
 * Verifies SSH probe parsing and error handling for GitHub auth detection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { SystemSshAuthProbe, mapProbeOutput } from '../src/adapters/ssh-auth.js';

const supportedConfiguration = 'hostname host.test\nuser git\nport 22\nidentityfile /fixture/key\nidentitiesonly yes\nbatchmode yes\npasswordauthentication no\nkbdinteractiveauthentication no\npubkeyauthentication yes\npreferredauthentications publickey\n';

test('ssh auth probe extracts the GitHub username from the SSH handshake output', async () => {
  const probe = new SystemSshAuthProbe({
    binaryPath: 'ssh',
    exec: async () => {
      const error = new Error('ssh exited') as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      error.code = '1';
      error.stderr =
        "Hi acmedeploy! You've successfully authenticated, but GitHub does not provide shell access.\n";
      throw error;
    }
  });

  const result = await probe.probeGithubUser('github.com-acmedeploy');

  assert.deepEqual(result, {
    ok: true,
    host: 'github.com-acmedeploy',
    githubUser: 'acmedeploy'
  });
});

test('mapProbeOutput returns a warning result when no GitHub username is present', () => {
  assert.deepEqual(mapProbeOutput('github.com', 'Permission denied (publickey).'), {
    ok: false,
    host: 'github.com',
    message: 'Permission denied (publickey).'
  });
});

test('SSH inspection preserves URL user/port, inherited IdentityAgent and caller environment', async () => {
  const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const env = { SSH_AUTH_SOCK: '/fixture/agent' };
  const probe = new SystemSshAuthProbe({ exec: async (_file, args, options) => {
    calls.push({ args, env: options?.env });
    if (args[0] === '-G') return { stdout: 'hostname github.test\nuser alice\nport 2222\nidentityagent /custom/agent\nidentityfile /fixture/key\nidentitiesonly yes\nbatchmode yes\npasswordauthentication no\nkbdinteractiveauthentication no\npubkeyauthentication yes\npreferredauthentications publickey\nremotecommand none\n', stderr: '' };
    return { stdout: '', stderr: "Hi alice! You've successfully authenticated" };
  } });
  const result = await probe.probeGithubUser('alias.test', { user: 'alice', port: 2222, path: '/acme/repo.git', env });
  assert.equal(result.githubUser, 'alice'); assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args, ['-G', '-p', '2222', 'alice@alias.test', "git-receive-pack '/acme/repo.git'"]);
  assert.deepEqual(calls[2].args, ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-p', '2222', 'alice@alias.test']);
  assert.ok(calls.every((call) => call.env === env));
  assert.deepEqual(env, { SSH_AUTH_SOCK: '/fixture/agent' });
});

test('SSH context mismatch, unavailable inspection, malformed output and remote commands never reach handshake', async () => {
  for (const variant of ['agent', 'identity', 'proxy', 'user', 'unavailable', 'malformed', 'remotecommand']) {
    let handshakes = 0;
    const probe = new SystemSshAuthProbe({ exec: async (_file, args) => {
      if (args[0] !== '-G') { handshakes++; return { stdout: "Hi wrong! You've successfully authenticated", stderr: '' }; }
      if (variant === 'unavailable') throw new Error('missing ssh');
      if (variant === 'malformed') return { stdout: 'not openssh configuration', stderr: '' };
      const receive = args.at(-1)?.startsWith('git-receive-pack');
      const key = { agent: 'identityagent', identity: 'identityfile', proxy: 'proxycommand', user: 'user' }[variant];
      const configuration = supportedConfiguration.split('\n').filter((line) => !key || !line.startsWith(`${key} `)).join('\n');
      return { stdout: configuration + `remotecommand ${variant === 'remotecommand' ? 'custom' : 'none'}\n${key ? `${key} ${receive ? 'push-value' : 'probe-value'}\n` : ''}`, stderr: '' };
    } });
    const result = await probe.probeGithubUser('host.test', { path: 'acme/repo.git' });
    assert.equal(result.ok, false, variant); assert.equal(handshakes, 0, variant);
  }
});

test('an alternate diagnostic SSH binary is unverified before inspection or handshake', async () => {
  let attempts = 0;
  const probe = new SystemSshAuthProbe({ binaryPath: '/fixture/alternate-ssh', exec: async () => {
    attempts++;
    return { stdout: 'hostname host.test\nuser git\nport 22\n', stderr: "Hi work! You've successfully authenticated" };
  } });
  const result = await probe.probeGithubUser('host.test', { path: 'acme/repo.git' });
  assert.equal(result.ok, false); assert.match(result.message!, /differs from Git transport/);
  assert.equal(attempts, 0);
});


test('partial and interactive SSH contexts cannot qualify a greeting', async () => {
  for (const configuration of ['hostname host.test\nuser git\nport 22\n', supportedConfiguration.replace('batchmode yes', 'batchmode no')]) {
    let handshakes = 0;
    const probe = new SystemSshAuthProbe({ exec: async (_file, args) => {
      if (args[0] === '-G') return { stdout: configuration, stderr: '' };
      handshakes++; return { stdout: "Hi wrong! You've successfully authenticated", stderr: '' };
    } });
    assert.equal((await probe.probeGithubUser('host.test', { path: 'acme/repo.git' })).ok, false);
    assert.equal(handshakes, 0);
  }
});

test('a terminated handshake with partial greeting remains unverified', async () => {
  const probe = new SystemSshAuthProbe({ exec: async (_file, args) => {
    if (args[0] === '-G') return { stdout: supportedConfiguration, stderr: '' };
    throw Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM', stderr: "Hi wrong! You've successfully authenticated" });
  } });
  assert.equal((await probe.probeGithubUser('host.test', { path: 'acme/repo.git' })).ok, false);
});

test('OpenSSH may omit default preferred authentication order without making the context partial', async () => {
  const configuration = supportedConfiguration.replace('preferredauthentications publickey\n', '');
  const probe = new SystemSshAuthProbe({ exec: async (_file, args) => args[0] === '-G'
    ? { stdout: configuration, stderr: '' }
    : { stdout: '', stderr: "Hi fixture! You've successfully authenticated" } });
  assert.equal((await probe.probeGithubUser('host.test', { path: 'acme/repo.git' })).ok, true);
});


test('invalid explicit SSH ports refuse before any configuration or handshake execution', async () => {
  for (const port of [0, -1, 65536, 1.5]) {
    let attempts = 0;
    const probe = new SystemSshAuthProbe({ exec: async () => { attempts++; return { stdout: supportedConfiguration, stderr: '' }; } });
    assert.equal((await probe.probeGithubUser('host.test', { port, path: 'acme/repo.git' })).ok, false);
    assert.equal(attempts, 0);
  }
});


test('diagnostics distinguish interactive config and retain all independent reasons without extra calls', async () => {
  const calls: string[][] = [];
  const probe = new SystemSshAuthProbe({ exec: async (_file, args) => {
    calls.push(args);
    assert.equal(args[0], '-G', 'rejected contexts must never handshake');
    const receive = args.at(-1)?.startsWith('git-receive-pack');
    return { stdout: supportedConfiguration.replace('batchmode yes', receive ? 'batchmode no' : 'batchmode yes')
      .replace('/fixture/key', receive ? '/fixture/private-push-key' : '/fixture/private-probe-key')
      + 'remotecommand custom-fixture\n', stderr: '' };
  } });
  const result = await probe.probeGithubUser('alias.test', { user: 'alice', port: 2222, path: 'fixture/repo.git' });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 2);
  assert.match(result.message!, /Git can ask for your key passphrase/);
  assert.equal(result.message!.split('\n').filter((line) => line.startsWith('- ')).length, 3);
  assert.match(result.message!, /configured remote command/);
  assert.match(result.message!, /different SSH settings/);
  assert.doesNotMatch(result.message!, /private-push-key|private-probe-key|custom-fixture/);
  assert.match(result.message!, /ssh -T -p '2222' -- 'alice@alias.test'/);
  assert.match(result.message!, /may ask.*passphrase/);
  assert.match(result.message!, /does not verify.*push/);
});

test('interactive-only diagnostics do not invent additional differences', async () => {
  const probe = new SystemSshAuthProbe({ exec: async (_file, args) => ({
    stdout: supportedConfiguration.replace('batchmode yes', args.includes('-T') ? 'batchmode yes' : 'batchmode no'), stderr: ''
  }) });
  const result = await probe.probeGithubUser('alias.test', { path: 'fixture/repo.git' });
  assert.equal(result.ok, false);
  assert.match(result.message!, /Git can ask for your key passphrase/);
  assert.equal(result.message!.split('\n').filter((line) => line.startsWith('- ')).length, 1);
  assert.match(result.message!, /ssh -T -- 'alias.test'/);
});

test('failed connection explains uncertainty without claiming missing keys', async () => {
  const probe = new SystemSshAuthProbe({ exec: async (_file, args) => {
    if (args[0] === '-G') return { stdout: supportedConfiguration, stderr: '' };
    throw Object.assign(new Error('Command failed: fixture command'), { stderr: 'Permission denied (publickey).' });
  } });
  const result = await probe.probeGithubUser('alias.test', { path: 'fixture/repo.git' });
  assert.equal(result.ok, false);
  assert.match(result.message!, /connection check failed/);
  assert.match(result.message!, /Permission denied/);
  assert.doesNotMatch(result.message!, /Command failed: fixture|key is missing/);
});


test('manual advice preserves hostile alias and user as one shell argument without executing input', async () => {
  const host = "alias'$(printf INJECTED);.test";
  const user = "user'`printf INJECTED`";
  const probe = new SystemSshAuthProbe({ exec: async () => ({ stdout: supportedConfiguration.replace('batchmode yes', 'batchmode no'), stderr: '' }) });
  const result = await probe.probeGithubUser(host, { user, port: 2222, path: 'fixture/repo.git' });
  const command = result.message!.split('\n').find((line) => line.trimStart().startsWith('ssh -T'))?.trim();
  // This shell function replaces ssh entirely; no network or SSH executable can run.
  assert.ok(command, 'manual command must occupy its own complete line');
  const captured = spawnSync('/bin/sh', ['-c', `ssh() { printf '%s\\0' "$@"; }; ${command}`]);
  assert.equal(captured.status, 0);
  assert.equal(captured.stderr.toString(), '');
  assert.deepEqual(captured.stdout.toString().split('\0'), ['-T', '-p', '2222', '--', `${user}@${host}`, '']);
});

test('unsafe display characters omit executable advice without changing rejection', async () => {
  const probe = new SystemSshAuthProbe({ exec: async () => ({ stdout: supportedConfiguration.replace('batchmode yes', 'batchmode no'), stderr: '' }) });
  const result = await probe.probeGithubUser('fixture\nalias', { path: 'fixture/repo.git' });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message!, /Manual connection check:|fixture\nalias/);
});

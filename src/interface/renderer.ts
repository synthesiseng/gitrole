/*
 * Renders human-readable CLI output for saved roles, status, and diagnosis results.
 */
import { describeHttpsAuth, summarizeSshMessage } from '../application/alignment.js';
import os from 'node:os';

import chalk from 'chalk';

import type {
  CurrentRoleResult,
  DoctorResult,
  ImportCurrentRoleResult,
  ListRolesResult,
  PinRepoPolicyResult,
  RemoteUseResult,
  StatusResult,
  UseRoleResult
} from '../application/contracts.js';
import { UNMATCHED_ROLE_NAME, type Role } from '../domain/role.js';

export function renderSavedRole(role: Role): string {
  const lines = [
    `${chalk.green('saved')} ${chalk.bold(role.name)}`,
    formatDetail('commit', formatIdentityPair(role))
  ];

  if (role.sshKeyPath) {
    lines.push(formatDetail('ssh', formatPath(role.sshKeyPath)));
  }

  const pushAuth = formatPushAuth(role.githubUser, role.githubHost);

  if (pushAuth) {
    lines.push(formatDetail('push', pushAuth));
  }

  return lines.join('\n');
}

export function renderUsedRole(result: UseRoleResult): string {
  const lines = [
    `${chalk.green('switched to')} ${chalk.bold(result.role.name)}`,
    formatDetail('scope', result.scope),
    formatDetail('commit', formatIdentityPair(result.role))
  ];

  if (result.ssh) {
    const status = result.ssh.ok ? ` (${chalk.green('loaded')})` : '';
    lines.push(formatDetail('ssh', `${formatPath(result.ssh.path)}${status}`));
  }

  const pushAuth = formatPushAuth(result.role.githubUser, result.role.githubHost);

  if (pushAuth) {
    lines.push(formatDetail('push', pushAuth));
  }

  return lines.join('\n');
}

export function renderCurrentRole(result: CurrentRoleResult): string {
  if (result.role) {
    const lines = [
      `${chalk.green('current role')} ${chalk.bold(result.role.name)}`,
      formatDetail('commit', formatIdentityPair(result.role))
    ];

    if (result.role.sshKeyPath) {
      lines.push(formatDetail('ssh', formatPath(result.role.sshKeyPath)));
    }

    const pushAuth = formatPushAuth(result.role.githubUser, result.role.githubHost);

    if (pushAuth) {
      lines.push(formatDetail('push', pushAuth));
    }

    return lines.join('\n');
  }

  return [
    chalk.yellow('no matching role'),
    formatDetail('commit', formatIdentityPair(result.identity))
  ].join('\n');
}

export function renderImportedCurrentRole(result: ImportCurrentRoleResult): string {
  return [
    `${chalk.green('imported current identity as')} ${chalk.bold(result.role.name)}`,
    formatDetail('commit', formatIdentityPair(result.role)),
    formatDetail('scope', result.scope)
  ].join('\n');
}

export function renderRoleList(result: ListRolesResult): string {
  if (result.roles.length === 0) {
    return chalk.dim('no saved roles');
  }

  return result.roles
    .map((role) => {
      const marker = role.name === result.activeRoleName ? chalk.green('*') : ' ';
      const ssh = role.sshKeyPath ? ` ${chalk.dim(formatPath(role.sshKeyPath))}` : '';
      const githubUser = role.githubUser ? ` ${chalk.dim(`gh:${role.githubUser}`)}` : '';
      const githubHost = role.githubHost ? ` ${chalk.dim(`host:${role.githubHost}`)}` : '';

      return `${marker} ${chalk.bold(role.name)} ${chalk.dim(
        formatIdentityPair(role)
      )}${ssh}${githubUser}${githubHost}`;
    })
    .join('\n');
}

export function renderRemovedRole(role: Role): string {
  return `${chalk.green('removed')} ${chalk.bold(role.name)}`;
}

export function renderError(message: string): string {
  return `${chalk.red('error:')} ${message}`;
}

export function renderRepoNote(): string {
  return [
    `${chalk.cyan('repo note:')} alignment issues detected`,
    `  ${chalk.cyan('run:')} gitrole status`
  ].join('\n');
}

export function renderSshNote(message: string): string {
  return `${chalk.cyan('ssh note:')} ${message}`;
}

export function renderRemoteUse(result: RemoteUseResult): string {
  return [
    `${chalk.green('updated remote')} ${chalk.bold('origin')} ${chalk.dim(`for ${result.role.name}`)}`,
    formatDetail('from', result.previousUrl),
    formatDetail('to', result.nextUrl)
  ].join('\n');
}

export function renderPinnedRepoPolicy(result: PinRepoPolicyResult): string {
  return [
    `${chalk.green('pinned role')} ${chalk.bold(result.role.name)}`,
    formatDetail('file', '.gitrole'),
    formatDetail('default', result.repoPolicy.defaultRole),
    formatDetail('allowed', result.repoPolicy.allowedRoles.join(', '))
  ].join('\n');
}

export function renderStatus(result: StatusResult, options: { verbose?: boolean; offline?: boolean } = {}): string {
  const summary =
    result.overall === 'aligned' ? chalk.green(result.overall) : chalk.yellow(result.overall);
  const roleLabel =
    result.roleName === UNMATCHED_ROLE_NAME
      ? chalk.yellow('no matching role')
      : chalk.bold(result.roleName);

  const localOnly = options.offline ? ' (local checks only)' : '';
  const lines = [`${roleLabel}  ${summary}${localOnly}`];
  lines.push(formatDetail('checks', `commit ${result.commit}  remote ${result.remote}  auth ${result.auth}  policy ${result.policy}`));

  lines.push(formatDetail('commit', result.commitIdentity ? escapeIdentityControls(result.commitIdentity) : chalk.dim('unset')));

  if (result.envNote) {
    lines.push(formatDetail('env', escapeIdentityControls(result.envNote)));
  }

  if (result.pushAuth) {
    lines.push(formatDetail('push', result.pushAuth));
  }

  lines.push(formatDetail('scope', formatStatusScope(result)));

  if (result.historyNote) {
    lines.push(formatDetail('history', escapeIdentityControls(result.historyNote)));
  } else if (!result.lastNonMergeCommit) {
    lines.push(formatDetail('history', 'no non-merge commits yet'));
  }

  if (result.repoPolicy) {
    lines.push(formatDetail('policy', formatRepoPolicyStatus(result.repoPolicy)));
  }

  if (result.overall !== 'aligned') {
    lines.push(formatDetail('next', `Review details: gitrole doctor${options.offline ? ' --offline' : ''} --verbose`));
  }

  return lines.join('\n');
}

export function renderShortStatus(result: StatusResult): string {
  // Field order is the status --short contract:
  // role scope override commit remote auth policy overall
  return [
    `role=${result.roleName}`,
    `scope=${result.scope}`,
    `override=${result.localOverride}`,
    `commit=${result.commit}`,
    `remote=${result.remote}`,
    `auth=${result.auth}`,
    `policy=${result.policy}`,
    `overall=${result.overall}`
  ].join(' ');
}

/** Renders each diagnostic check once; verbose adds context without observing again. */
export function renderDoctor(
  result: DoctorResult,
  title = 'doctor',
  options: { verbose?: boolean; offline?: boolean } = {}
): string {
  const probeMessages = [result.sshAuth, ...(result.repository.push?.targets.map((target) => target.sshAuth) ?? [])]
    .flatMap((probe) => probe?.message ? [probe.message] : []);
  const summarizeCheck = (message: string): string => {
    const probeMessage = probeMessages.find((candidate) => message.startsWith(candidate));
    return probeMessage ? summarizeSshMessage(probeMessage, options.verbose) + message.slice(probeMessage.length) : message;
  };
  const lines = [
    `${chalk.bold(title)}  ${result.overall}${options.offline ? ' (local checks only)' : ''}`,
    formatDetail('role', result.role?.name ?? chalk.yellow('no matching role')),
    formatDetail('scope', result.scope.effective),
    formatDetail('commit', formatDiagnosedIdentity(result.commitIdentity))
  ];
  const expected = formatPushAuth(result.role?.githubUser, result.role?.githubHost);
  if (expected) lines.push(formatDetail('expected', expected));
  for (const target of result.repository.push?.targets ?? []) {
    lines.push(formatDetail('push', target.remote.url));
  }

  if (options.verbose) {
    lines.push(formatDetail('local', result.scope.hasLocalOverride ? 'active' : 'inactive'));
    if (shouldRenderGlobalIdentity(result)) {
      lines.push(formatDetail('global', formatIdentityPair(result.configuredIdentity.global)));
    }
    if (result.repository.isInsideWorkTree) {
      lines.push(formatDetail('repo', result.repository.topLevelPath ?? 'current directory'));
      if (result.repository.currentBranch) lines.push(formatDetail('branch', result.repository.currentBranch));
      if (result.repository.upstreamBranch) lines.push(formatDetail('upstream', result.repository.upstreamBranch));
      if (result.repository.fetchRemote) lines.push(formatDetail('fetch', result.repository.fetchRemote.url));
      const remote = result.repository.remote;
      if (remote?.host) lines.push(formatDetail('rhost', remote.host));
      if (remote?.owner && remote.repository) lines.push(formatDetail('rrepo', `${remote.owner}/${remote.repository}`));
      if (result.sshAuth?.githubUser) lines.push(formatDetail('auth', `${result.sshAuth.githubUser} via ${result.sshAuth.host}`));
    }
    if (result.repoPolicy) {
      lines.push(formatDetail('policy', `.gitrole (v${result.repoPolicy.version})`));
      lines.push(formatDetail('default', result.repoPolicy.defaultRole));
      lines.push(formatDetail('allowed', result.repoPolicy.allowedRoles.join(', ')));
    }
  }

  // Collapse only the known duplicate cause, never equal prose at distinct endpoints.
  const hasMixedScopeWarning = result.scope.effective === 'mixed' && result.checks.some((check) =>
    check.status === 'warn' && check.label === 'scope'
      && check.message === 'effective commit identity mixes Git config sources');
  const checks = result.checks.filter((check) => !(hasMixedScopeWarning && result.role
    && check.status === 'warn' && check.label === 'scope'
    && check.message === `selected role ${result.role.name} is split across Git config sources`));
  const okCount = checks.filter((check) => check.status === 'ok').length;
  const warnings = checks.filter((check) => check.status === 'warn');
  lines.push('', `${chalk.bold('checks')}  ${okCount} ok, ${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}`);
  for (const check of checks) {
    if (!options.verbose && check.status === 'ok') continue;
    const status = check.status === 'ok' ? chalk.green('ok')
      : check.status === 'warn' ? chalk.yellow('warn') : chalk.blue('info');
    const continuation = ' '.repeat(2 + check.status.length + 1 + Math.max(6, check.label.length) + 1);
    // Identity-bearing diagnostics can include raw saved/configured values.
    // Keep intentional multiline transport diagnostics on their existing path.
    const rawMessage = ['role', 'fix', 'commit', 'identity', 'env'].includes(check.label)
      ? escapeIdentityControls(check.message) : check.message;
    const message = summarizeCheck(rawMessage).replace(/\n/g, `\n${continuation}`);
    lines.push(`  ${status} ${check.label.padEnd(6, ' ')} ${message}`);
  }

  if (warnings.length) lines.push('', formatDetail('next', doctorNextAction(result, warnings)));
  return lines.join('\n');
}

/** Advice from the same observation, independent of verbosity; never executes a command. */
function doctorNextAction(result: DoctorResult, warnings: DoctorResult['checks']): string {
  const has = (...labels: string[]) => warnings.some((check) => labels.includes(check.label));
  if (!result.repository.isInsideWorkTree) return 'Run doctor from the intended Git repository.';
  const push = result.repository.push;
  if (!push || push.message || !push.targets.length) {
    return "Review and configure the intended push destination, then run doctor again; gitrole won't guess the URL.";
  }
  // History stays first, but never invite a commit under an unresolved identity/policy.
  if (has('history')) return has('role', 'scope', 'commit', 'identity', 'policy')
    ? 'Prepare the first commit after resolving the reported identity and policy warnings.'
    : 'Create the intended first commit before pushing.';
  if (has('policy')) return 'Resolve the effective identity and .gitrole policy warnings before committing; review allowed/default roles before changing configuration.';
  if (has('role', 'scope', 'commit', 'identity')) return 'Confirm the intended commit identity against the saved role and effective Git configuration before committing.';
  if (has('auth')) {
    // One transport-specific action cannot cover a mixed destination set.
    if (push.targets.some((target) => target.remote.protocol === 'ssh')
      && push.targets.some((target) => target.remote.protocol === 'https')) {
      if (push.targets.some((target) => target.message || target.remote.protocol === 'unknown')) {
        return 'Push destinations need separate checks; review the unsupported push/SSH configuration and every destination in --verbose before choosing an account check.';
      }
      return 'SSH and HTTPS push destinations need separate checks; review --verbose details before choosing an account check.';
    }
    // A local HTTPS pin warning cannot be resolved by observing an SSH endpoint.
    if (push.targets.some((target) => target.remote.protocol === 'https')
      && describeHttpsAuth({ role: result.role, repoPolicy: result.repoPolicy }).auth === 'warn') {
      return 'Review the saved role and .gitrole pin for each HTTPS push destination; provider credentials have not been observed.';
    }
    if (push.targets.some((target) => target.message || target.remote.protocol === 'unknown')) {
      return 'Review the reported unsupported push/SSH configuration before choosing an account check; a plain SSH command cannot reproduce it.';
    }
    if (push.targets.some((target) => target.remote.protocol === 'ssh')) {
      return 'For an explicit SSH account check, choose to run gitrole auth test in a terminal. It may prompt, connect, run configured commands or change SSH state; it cannot verify a future Git push.';
    }
    return 'Review the saved role and .gitrole pin for each HTTPS push destination; provider credentials have not been observed.';
  }
  if (has('remote', 'host')) return 'Compare each listed push destination with the intended repository and role host before changing remote configuration.';
  return 'Resolve the remaining reported warnings before committing or pushing; review their details without assuming a successful check.';
}

function formatDetail(label: string, value: string): string {
  return `  ${chalk.cyan(label.padEnd(5, ' '))} ${value}`;
}

function formatPath(input: string): string {
  const home = os.homedir();

  if (input === home) {
    return '~';
  }

  if (input.startsWith(`${home}/`)) {
    return input.replace(home, '~');
  }

  return input;
}

function formatDiagnosedValue(input: {
  value?: string;
  source: DoctorResult['commitIdentity']['fullName']['source'];
}): string {
  if (!input.value) {
    return chalk.dim(`not set (${input.source})`);
  }

  return `${escapeIdentityControls(input.value)} ${chalk.dim(`(${input.source})`)}`;
}

function formatDiagnosedIdentity(identity: DoctorResult['commitIdentity']): string {
  return `${formatDiagnosedValue(identity.fullName)} <${formatDiagnosedValue(identity.email)}>`;
}

function formatStatusScope(result: StatusResult): string {
  if (result.localOverride && result.scope === 'local') {
    return 'local override';
  }

  if (result.localOverride && result.scope === 'mixed') {
    return 'mixed override';
  }

  return result.scope;
}

function shouldRenderGlobalIdentity(result: DoctorResult): boolean {
  if (!result.scope.hasLocalOverride) {
    return false;
  }

  return (
    result.configuredIdentity.global.fullName !== undefined ||
    result.configuredIdentity.global.email !== undefined
  ) && (
    result.configuredIdentity.global.fullName !== result.commitIdentity.fullName.value ||
    result.configuredIdentity.global.email !== result.commitIdentity.email.value
  );
}

function formatIdentityPair(identity: { fullName?: string; email?: string }): string {
  const fullName = identity.fullName === undefined ? chalk.dim('not set') : escapeIdentityControls(identity.fullName);
  const email = identity.email === undefined ? chalk.dim('not set') : escapeIdentityControls(identity.email);

  return `${fullName} <${email}>`;
}

function escapeIdentityControls(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function formatPushAuth(githubUser?: string, githubHost?: string): string | undefined {
  if (githubUser && githubHost) {
    return `${githubUser} via ${githubHost}`;
  }

  if (githubUser) {
    return githubUser;
  }

  if (githubHost) {
    return githubHost;
  }

  return undefined;
}

function formatRepoPolicyStatus(repoPolicy: NonNullable<StatusResult['repoPolicy']>): string {
  if (repoPolicy.status === 'default') {
    return `default role ${repoPolicy.defaultRole}`;
  }

  if (repoPolicy.status === 'allowed') {
    return `allowed role ${repoPolicy.effectiveRole} (default: ${repoPolicy.defaultRole})`;
  }

  return repoPolicy.effectiveRole
    ? `role ${repoPolicy.effectiveRole} is not allowed here (default: ${repoPolicy.defaultRole})`
    : `current identity does not match an allowed role here (default: ${repoPolicy.defaultRole})`;
}
